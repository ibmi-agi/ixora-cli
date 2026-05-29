# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6",
#   "jsonschema>=4",
# ]
# ///
"""Build, register, update, and inspect IBM i agents on a running Ixora stack.

This is the self-contained, host-side counterpart of Ixora's in-app agent-builder
agent. It does exactly what `ixora/agents/tools/builder.py` (the `AgentBuilderTools`
toolkit) does — writes a SQL-tool YAML to the stack's user_tools dir and creates /
updates an agent **component** via the AgentOS components API — but driven by a coding
agent (Claude Code) instead of a chat agent inside the stack.

CONTRACT — keep in sync with `ixora/agents/tools/builder.py`:
  * `_IBMI_CLI_TOOLS` (the rehydration tool list — order & contents are load-bearing),
  * the `config` dict shape (`db.id`, `dependencies.ibmi_*`, the `model` dict),
  * the protected config keys, and the `/components` payloads.
The SQL-tool JSON Schema lives at ../assets/sql-tools-config.schema.json (also a
snapshot — see ../assets/SOURCES.md). If agents register but fail to run, the most
likely cause is drift between this file and builder.py.

Target (which AgentOS to talk to) is resolved the same way the `ixora` CLI resolves it
(see ../references/endpoint-resolution.md): from ~/.ixora/ixora-systems.yaml + .env, or
via --url/--key overrides.

Run with `uv run agent_builder.py <subcommand> ...` (auto-installs deps via the PEP 723
header above). Fallback: `pip install pyyaml jsonschema` then `python3 agent_builder.py`.

Every subcommand prints a JSON envelope (`{"ok": true, ...}` / `{"ok": false, "error": ...}`)
to stdout and exits 0 on success, 1 on failure.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "Missing dependency 'pyyaml'. Run this script with `uv run` (auto-installs "
        "deps), or `pip install pyyaml jsonschema`.\n"
    )
    sys.exit(1)

# jsonschema is optional-at-runtime: if absent we degrade to a warning (matching
# builder.py's _validate_tools_yaml), but `uv run` always provides it.
try:
    import jsonschema  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    jsonschema = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Contract constants — mirror ixora/agents/tools/builder.py
# ---------------------------------------------------------------------------

# The IBM i CLI toolkit every builder-created agent gets. Plain {name, description}
# dicts; the live Functions (confirmation flags on validate_and_run_sql/run_cl, the
# list->describe->run pre_hook on run_tool) are restored at run time by
# IxoraRegistry.rehydrate_function from the shared IBMiCLITools() singleton, keyed by
# these names. ORDER AND CONTENTS ARE PART OF THE REHYDRATION CONTRACT.
_IBMI_CLI_TOOLS: list[dict[str, str]] = [
    {
        "name": "validate_and_run_sql",
        "description": "Validate then execute SQL against IBM i",
    },
    {"name": "run_cl", "description": "Execute an IBM i CL command via QCMDEXC"},
    {"name": "run_tool", "description": "Execute a named YAML tool"},
    {"name": "describe_tool", "description": "Show a YAML tool's parameter schema"},
    {"name": "list_tools", "description": "List available YAML-defined IBM i tools"},
    {"name": "list_schemas", "description": "List database schemas"},
    {"name": "list_tables", "description": "List tables in a schema"},
    {"name": "list_columns", "description": "List columns for a table"},
    {"name": "describe", "description": "Generate DDL for an object"},
    {"name": "validate_sql", "description": "Validate SQL syntax"},
]

# register/update own these keys outright (they wire the toolkit, the per-component
# scope, and the registry db). config_overrides may never clobber them.
_PROTECTED_CONFIG_KEYS: tuple[str, ...] = ("tools", "dependencies", "db")

# Default sources block create_tool_yaml injects when the YAML omits one. Env-var
# placeholders are expanded by the stack at tool-execution time, not here.
_DEFAULT_SOURCES = {
    "default": {
        "host": "${DB2i_HOST}",
        "user": "${DB2i_USER}",
        "password": "${DB2i_PASS}",
        "port": 8076,
    }
}

_FALLBACK_MODEL_ID = "anthropic:claude-sonnet-4-6"

# ~/.ixora layout (mirrors ixora-cli/src/lib/constants.ts)
_DEFAULT_API_PORT = 18000


# ---------------------------------------------------------------------------
# Small result/exception helpers
# ---------------------------------------------------------------------------


class BuilderError(Exception):
    """A user-facing failure; its message goes into the JSON error envelope."""


def _emit(payload: dict[str, Any]) -> "NoReturnExit":
    """Print a JSON envelope and exit (0 if ok, 1 otherwise)."""
    print(json.dumps(payload, indent=2))
    raise SystemExit(0 if payload.get("ok") else 1)


# Type alias only used so _emit's intent reads clearly.
NoReturnExit = SystemExit


# ---------------------------------------------------------------------------
# ~/.ixora state readers — mirror ixora-cli/src/lib/{env,systems,constants}.ts
# ---------------------------------------------------------------------------


def _ixora_dir(args: argparse.Namespace) -> Path:
    override = getattr(args, "ixora_dir", None)
    if override:
        return Path(override).expanduser()
    return Path(os.environ.get("IXORA_DIR") or (Path.home() / ".ixora"))


def _env_get(ixora_dir: Path, key: str) -> str:
    """Read KEY from ~/.ixora/.env, stripping matched surrounding quotes."""
    env_file = ixora_dir / ".env"
    if not env_file.is_file():
        return ""
    for line in env_file.read_text().splitlines():
        if line.startswith(f"{key}="):
            val = line[len(key) + 1 :]
            if (val.startswith("'") and val.endswith("'")) or (
                val.startswith('"') and val.endswith('"')
            ):
                val = val[1:-1]
            return val
    return ""


def _api_port_base(ixora_dir: Path) -> int:
    raw = _env_get(ixora_dir, "IXORA_API_PORT")
    if not raw:
        return _DEFAULT_API_PORT
    try:
        n = int(raw)
    except ValueError:
        return _DEFAULT_API_PORT
    return n if 1024 <= n <= 65535 else _DEFAULT_API_PORT


def _read_systems(ixora_dir: Path) -> list[dict[str, str]]:
    """Parse ~/.ixora/ixora-systems.yaml the same line-oriented way the CLI does."""
    cfg = ixora_dir / "ixora-systems.yaml"
    if not cfg.is_file():
        return []
    systems: list[dict[str, str]] = []
    current: dict[str, str] | None = None

    def commit() -> None:
        if not current or not current.get("id"):
            return
        kind = current.get("kind", "managed")
        if kind == "external":
            if not current.get("url"):
                return  # skip malformed external entries
            systems.append(
                {
                    "id": current["id"],
                    "name": current.get("name", current["id"]),
                    "kind": "external",
                    "url": current["url"],
                }
            )
        else:
            systems.append(
                {
                    "id": current["id"],
                    "name": current.get("name", current["id"]),
                    "kind": "managed",
                    "mode": current.get("mode", "full"),
                }
            )

    for line in cfg.read_text().splitlines():
        m = re.match(r"^ {2}- id: (.+)$", line)
        if m:
            commit()
            current = {"id": m.group(1).strip()}
            continue
        if current is None:
            continue
        for field, pat in (
            ("name", r"^ {4}name: *'?([^']*)'?"),
            ("kind", r"^ {4}kind: *'?(managed|external)'?"),
            ("mode", r"^ {4}mode: *'?([^']*)'?"),
            ("url", r"^ {4}url: *'?([^']*)'?"),
        ):
            fm = re.match(pat, line)
            if fm:
                current[field] = fm.group(1).strip()
                break
    commit()
    return systems


def _index_among_managed(systems: list[dict[str, str]], target_id: str) -> int:
    managed = [s for s in systems if s.get("kind", "managed") == "managed"]
    for i, s in enumerate(managed):
        if s["id"] == target_id:
            return i
    return -1


class Target:
    """Resolved AgentOS endpoint + auth + user_tools location for one invocation."""

    def __init__(
        self,
        base_url: str,
        key: str | None,
        timeout: int,
        system_id: str | None,
        kind: str,
        user_tools_dir: Path | None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.key = key or None
        self.timeout = timeout
        self.system_id = system_id
        self.kind = kind  # "managed" | "external" | "url"
        self.user_tools_dir = user_tools_dir

    def describe(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "base_url": self.base_url,
            "system_id": self.system_id,
            "kind": self.kind,
            "auth": "bearer" if self.key else "none",
            "user_tools_dir": str(self.user_tools_dir) if self.user_tools_dir else None,
        }
        # Managed systems carry a local api-<id> container whose bundled `ibmi`
        # binary targets the ixora-configured IBM i box (IBMI_* env). Introspect
        # through it via this script's `ibmi` subcommand — never the host `ibmi`.
        if self.kind == "managed" and self.system_id:
            info["ibmi_via"] = f"agent_builder.py ibmi --system {self.system_id} -- ..."
        return info


def _resolve_target(args: argparse.Namespace) -> Target:
    """Mirror ixora-cli/src/lib/agentos-resolver.ts (minus the docker-running check).

    Precedence: --url > --system > single configured system > IXORA_DEFAULT_SYSTEM.
    We deliberately do NOT shell out to `docker compose ps`; if the picked managed
    system isn't running, the HTTP call surfaces a clean connection error instead.
    """
    ixora_dir = _ixora_dir(args)
    timeout = int(getattr(args, "timeout", None) or 30)
    key_flag = getattr(args, "key", None)
    user_tools_override = getattr(args, "user_tools_dir", None)

    # 1. --url escape hatch.
    if getattr(args, "url", None):
        utd = Path(user_tools_override).expanduser() if user_tools_override else None
        return Target(args.url, key_flag, timeout, None, "url", utd)

    systems = _read_systems(ixora_dir)
    if not systems:
        raise BuilderError(
            "No systems configured in ~/.ixora/ixora-systems.yaml. Run "
            "`ixora stack install` or `ixora stack system add`, or pass --url."
        )

    # 2. Pick a target.
    sys_flag = getattr(args, "system", None)
    if sys_flag:
        target = next((s for s in systems if s["id"] == sys_flag), None)
        if target is None:
            ids = ", ".join(s["id"] for s in systems)
            raise BuilderError(f"No such system '{sys_flag}'. Configured: {ids}")
    elif len(systems) == 1:
        target = systems[0]
    else:
        default_id = _env_get(ixora_dir, "IXORA_DEFAULT_SYSTEM")
        target = next((s for s in systems if s["id"] == default_id), None)
        if target is None:
            ids = ", ".join(s["id"] for s in systems)
            raise BuilderError(
                f"Multiple systems configured — specify --system <id>. Available: {ids}"
            )

    # 3. base URL.
    if target["kind"] == "external":
        base_url = target["url"]
    else:
        idx = _index_among_managed(systems, target["id"])
        base_url = f"http://localhost:{_api_port_base(ixora_dir) + max(idx, 0)}"

    # 4. per-system key.
    id_upper = target["id"].upper().replace("-", "_")
    env_key = _env_get(ixora_dir, f"SYSTEM_{id_upper}_AGENTOS_KEY")
    key = key_flag if (key_flag and key_flag.strip()) else (env_key or None)

    # 5. user_tools dir. Managed bind-mounts ~/.ixora/user_tools -> /data/user_tools.
    #    External systems read user_tools from a host/container we can't see → None
    #    unless explicitly overridden.
    if user_tools_override:
        user_tools_dir: Path | None = Path(user_tools_override).expanduser()
    elif target["kind"] == "managed":
        user_tools_dir = ixora_dir / "user_tools"
    else:
        user_tools_dir = None

    return Target(base_url, key, timeout, target["id"], target["kind"], user_tools_dir)


# ---------------------------------------------------------------------------
# HTTP (stdlib urllib so the script needs no httpx)
# ---------------------------------------------------------------------------


def _http(method: str, url: str, key: str | None, body: Any, timeout: int) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1000]
        raise BuilderError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise BuilderError(
            f"Could not reach {url}: {exc.reason}. Is the stack running "
            "(`ixora stack status`)? Try --url to target a specific endpoint."
        ) from exc


# ---------------------------------------------------------------------------
# Schema validation + YAML scope (mirror builder.py)
# ---------------------------------------------------------------------------

_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "assets" / ("sql-tools-config.schema.json")
)
_TOOLS_SCHEMA: dict[str, Any] = (
    json.loads(_SCHEMA_PATH.read_text()) if _SCHEMA_PATH.is_file() else {}
)


def _validate_tools_yaml(data: dict[str, Any]) -> list[str]:
    """Validate against the bundled SQL-tools JSON Schema. Empty list == valid."""
    if not _TOOLS_SCHEMA or jsonschema is None:
        sys.stderr.write(
            "WARNING: schema validation skipped (schema or jsonschema unavailable).\n"
        )
        return []
    validator = jsonschema.Draft7Validator(_TOOLS_SCHEMA)
    errors: list[str] = []
    for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        path = ".".join(str(p) for p in err.absolute_path) or "(root)"
        errors.append(f"{path}: {err.message}")
    return errors


def _read_agent_yaml_scope(
    user_tools_dir: Path | None, agent_id: str
) -> tuple[list[str], list[dict[str, Any]]]:
    """Derive (extra_tools, extra_inventory) from <user_tools>/<agent_id>/tools.yaml.

    A missing file is NOT an error — it means the agent is toolset-only.
    """
    if user_tools_dir is None:
        return [], []
    tool_file = user_tools_dir / agent_id / "tools.yaml"
    if not tool_file.is_file():
        return [], []
    data = yaml.safe_load(tool_file.read_text()) or {}
    tools_section = data.get("tools") or {}
    if not isinstance(tools_section, dict):
        return [], []
    extra_tools: list[str] = []
    inventory: list[dict[str, Any]] = []
    for tname, body in tools_section.items():
        if not isinstance(body, dict):
            continue
        name = str(body.get("name", tname))
        extra_tools.append(name)
        params = body.get("parameters") or []
        if isinstance(params, list):
            pnames = [
                str(p.get("name", "") if isinstance(p, dict) else p) for p in params
            ]
        elif isinstance(params, dict):
            pnames = list(params.keys())
        else:
            pnames = []
        inventory.append(
            {
                "name": name,
                "description": str(body.get("description", "")),
                "parameters": pnames,
            }
        )
    return extra_tools, inventory


# ---------------------------------------------------------------------------
# Config assembly (mirror builder.py _build_agent_config / _resolve_model_dict)
# ---------------------------------------------------------------------------


def _model_dict(model_id: str) -> dict[str, str]:
    """Build the {provider,id,name} model dict from a 'provider:model-id' string.

    On rehydration AgentOS calls get_model(f"{provider}:{id}"), so provider+id are
    load-bearing; name is cosmetic (we set it to the id).
    """
    provider, _, ident = model_id.partition(":")
    if not provider or not ident:
        raise BuilderError(
            f"model must be 'provider:model-id' (e.g. anthropic:claude-sonnet-4-6); "
            f"got {model_id!r}."
        )
    return {"id": ident, "name": ident, "provider": provider}


_OPTIONAL_KEYS = (
    "num_history_runs",
    "add_history_to_context",
    "add_session_state_to_context",
    "enable_agentic_state",
    "enable_agentic_memory",
    "update_memory_on_run",
)


def _check_memory_exclusive(cfg: dict[str, Any]) -> None:
    if cfg.get("enable_agentic_memory") and cfg.get("update_memory_on_run"):
        raise BuilderError(
            "enable_agentic_memory and update_memory_on_run are mutually exclusive "
            "— set at most one."
        )


def _apply_overrides(config: dict[str, Any], overrides: dict[str, Any]) -> list[str]:
    """Merge config_overrides after stripping protected keys. Returns stripped keys."""
    stripped: list[str] = []
    for k in _PROTECTED_CONFIG_KEYS:
        if k in overrides:
            stripped.append(k)
    for k, v in overrides.items():
        if k not in _PROTECTED_CONFIG_KEYS:
            config[k] = v
    return stripped


def _load_json_arg(raw: str | None, label: str) -> dict[str, Any]:
    """Accept inline JSON or @path; return a dict ({} for None)."""
    if not raw:
        return {}
    text = raw
    if raw.startswith("@"):
        p = Path(raw[1:]).expanduser()
        if not p.is_file():
            raise BuilderError(f"{label}: file not found: {p}")
        text = p.read_text()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise BuilderError(f"{label} is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise BuilderError(f"{label} must be a JSON object.")
    return parsed


def _read_instructions(args: argparse.Namespace) -> str | None:
    if getattr(args, "instructions_file", None):
        p = Path(args.instructions_file).expanduser()
        if not p.is_file():
            raise BuilderError(f"--instructions-file not found: {p}")
        return p.read_text()
    return getattr(args, "instructions", None)


def _split_toolsets(raw: str | None) -> list[str] | None:
    if raw is None:
        return None
    return [t.strip() for t in raw.split(",") if t.strip()]


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_resolve(args: argparse.Namespace) -> None:
    target = _resolve_target(args)
    _emit({"ok": True, **target.describe()})


def cmd_create_tool_yaml(args: argparse.Namespace) -> None:
    target = _resolve_target(args)
    raw = (
        sys.stdin.read()
        if args.yaml_file == "-"
        else Path(args.yaml_file).expanduser().read_text()
    )
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise BuilderError(f"Invalid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise BuilderError("YAML must be a mapping (top-level object).")

    if "sources" not in data:
        data["sources"] = _DEFAULT_SOURCES

    errors = _validate_tools_yaml(data)
    if errors:
        _emit({"ok": False, "errors": errors})

    rendered = yaml.dump(data, default_flow_style=False, sort_keys=False)
    tool_names = list((data.get("tools") or {}).keys())

    if args.emit_stdout or target.user_tools_dir is None:
        # External / --url targets: we can't write to the remote host's user_tools.
        _emit(
            {
                "ok": True,
                "written": False,
                "reason": (
                    "external/url target — no known host user_tools dir. Deliver this "
                    "YAML to the AgentOS host's user_tools/<agent_id>/tools.yaml, or "
                    "re-run with --user-tools-dir."
                )
                if not args.emit_stdout
                else "emit-stdout requested",
                "agent_id": args.agent_id,
                "tools": tool_names,
                "yaml": rendered,
            }
        )

    tool_dir = target.user_tools_dir / args.agent_id
    tool_dir.mkdir(parents=True, exist_ok=True)
    tool_file = tool_dir / "tools.yaml"
    tool_file.write_text(rendered)
    _emit(
        {
            "ok": True,
            "written": True,
            "path": str(tool_file),
            "agent_id": args.agent_id,
            "tools": tool_names,
        }
    )


def cmd_register(args: argparse.Namespace) -> None:
    target = _resolve_target(args)
    instructions = _read_instructions(args)
    if not instructions:
        raise BuilderError("--instructions or --instructions-file is required.")
    if args.stage not in ("published", "draft"):
        raise BuilderError("--stage must be 'published' or 'draft'.")

    model_dict = _model_dict(args.model or _FALLBACK_MODEL_ID)
    options = _load_json_arg(getattr(args, "options_json", None), "--options-json")

    # config_overrides / session_state / metadata come from the options object.
    session_state = options.get("session_state") or None
    metadata = options.get("metadata") or None
    overrides = options.get("config_overrides") or {}
    for obj, label in (
        (session_state, "session_state"),
        (metadata, "metadata"),
        (overrides, "config_overrides"),
    ):
        if obj is not None and not isinstance(obj, dict):
            raise BuilderError(f"{label} must be a JSON object.")

    toolsets = _split_toolsets(args.toolsets) or []
    extra_tools, inventory = _read_agent_yaml_scope(
        target.user_tools_dir, args.agent_id
    )
    dependencies = {
        "ibmi_toolsets": list(toolsets),
        "ibmi_extra_tools": extra_tools,
        "ibmi_extra_inventory": inventory,
    }

    config: dict[str, Any] = {
        "name": args.name,
        "description": args.description,
        "instructions": instructions,
        "model": model_dict,
        "db": {"id": args.db_id},
        "dependencies": dependencies,
        "tools": [dict(t) for t in _IBMI_CLI_TOOLS],
    }
    if session_state:
        config["session_state"] = session_state
    for k in _OPTIONAL_KEYS:
        if options.get(k) is not None:
            config[k] = options[k]
    if metadata:
        config["metadata"] = metadata
    _check_memory_exclusive(config)
    stripped = _apply_overrides(config, overrides) if overrides else []

    component_id = options.get("component_id") or (
        f"{args.agent_id}-{uuid.uuid4().hex[:6]}"
    )
    body = {
        "name": args.name,
        "component_id": component_id,
        "component_type": "agent",
        "description": args.description,
        "stage": args.stage,
        "config": config,
    }
    _http("POST", f"{target.base_url}/components", target.key, body, target.timeout)
    _emit(
        {
            "ok": True,
            "component_id": component_id,
            "stage": args.stage,
            "config_keys": sorted(config.keys()),
            "stripped_overrides": stripped,
            "extra_tools": extra_tools,
            "base_url": target.base_url,
        }
    )


def _fetch_current_config(target: Target, component_id: str) -> dict[str, Any]:
    row = _http(
        "GET",
        f"{target.base_url}/components/{component_id}/configs/current",
        target.key,
        None,
        target.timeout,
    )
    cfg = row.get("config") if isinstance(row, dict) else None
    if not isinstance(cfg, dict):
        raise BuilderError(
            f"No current config for component {component_id!r} (is it a builder-made, "
            "DB-backed agent? built-in registry agents have no editable config)."
        )
    return cfg


def _post_new_version(
    target: Target, component_id: str, config: dict[str, Any], stage: str, notes: str
) -> Any:
    return _http(
        "POST",
        f"{target.base_url}/components/{component_id}/configs",
        target.key,
        {"config": config, "stage": stage, "notes": notes},
        target.timeout,
    )


def cmd_update_scope(args: argparse.Namespace) -> None:
    target = _resolve_target(args)
    toolsets = _split_toolsets(args.toolsets)
    if toolsets is None:
        raise BuilderError("--toolsets is required for update-scope.")
    extra_tools, inventory = _read_agent_yaml_scope(
        target.user_tools_dir, args.agent_id
    )
    current = _fetch_current_config(target, args.component_id)
    new_config = dict(current)
    new_config["dependencies"] = {
        "ibmi_toolsets": list(toolsets),
        "ibmi_extra_tools": extra_tools,
        "ibmi_extra_inventory": inventory,
    }
    notes = f"scope update via skill — toolsets={toolsets}, extras={len(extra_tools)}"
    resp = _post_new_version(target, args.component_id, new_config, "published", notes)
    _emit(
        {
            "ok": True,
            "component_id": args.component_id,
            "version": resp.get("version") if isinstance(resp, dict) else None,
        }
    )


def cmd_update(args: argparse.Namespace) -> None:
    target = _resolve_target(args)
    if args.stage not in ("published", "draft"):
        raise BuilderError("--stage must be 'published' or 'draft'.")

    options = _load_json_arg(getattr(args, "options_json", None), "--options-json")
    current = _fetch_current_config(target, args.component_id)
    new_config = dict(current)
    changed: list[str] = []

    def setk(key: str, value: Any) -> None:
        new_config[key] = value
        changed.append(key)

    if args.name is not None:
        setk("name", args.name)
    if args.description is not None:
        setk("description", args.description)
    instructions = _read_instructions(args)
    if instructions is not None:
        setk("instructions", instructions)
    if args.model is not None:
        setk("model", _model_dict(args.model))
    if args.db_id is not None:
        setk("db", {"id": args.db_id})

    # §2–§5 knobs come through --options-json (only keys present are applied).
    for k in _OPTIONAL_KEYS:
        if k in options and options[k] is not None:
            setk(k, options[k])
    if options.get("session_state"):
        if not isinstance(options["session_state"], dict):
            raise BuilderError("session_state must be a JSON object.")
        setk("session_state", options["session_state"])
    if options.get("metadata"):
        if not isinstance(options["metadata"], dict):
            raise BuilderError("metadata must be a JSON object.")
        setk("metadata", options["metadata"])

    toolsets = _split_toolsets(args.toolsets)
    if toolsets is not None:
        extra_tools, inventory = _read_agent_yaml_scope(
            target.user_tools_dir, args.agent_id
        )
        setk(
            "dependencies",
            {
                "ibmi_toolsets": list(toolsets),
                "ibmi_extra_tools": extra_tools,
                "ibmi_extra_inventory": inventory,
            },
        )

    overrides = options.get("config_overrides") or {}
    if overrides and not isinstance(overrides, dict):
        raise BuilderError("config_overrides must be a JSON object.")
    stripped = _apply_overrides(new_config, overrides) if overrides else []

    _check_memory_exclusive(new_config)
    # Never let the tool list change — only dependencies (above).
    new_config["tools"] = current.get("tools", [dict(t) for t in _IBMI_CLI_TOOLS])

    resp = _post_new_version(
        target, args.component_id, new_config, args.stage, args.notes
    )
    _emit(
        {
            "ok": True,
            "component_id": args.component_id,
            "version": resp.get("version") if isinstance(resp, dict) else None,
            "stage": args.stage,
            "changed_keys": changed,
            "stripped_overrides": stripped,
        }
    )


def cmd_list(args: argparse.Namespace) -> None:
    target = _resolve_target(args)
    agents: list[dict[str, Any]] = []
    utd = target.user_tools_dir
    if utd and utd.is_dir():
        for entry in sorted(utd.iterdir()):
            tool_file = entry / "tools.yaml"
            if entry.is_dir() and tool_file.is_file():
                try:
                    data = yaml.safe_load(tool_file.read_text())
                    count = len(data.get("tools", {})) if isinstance(data, dict) else 0
                except Exception:
                    count = 0
                agents.append(
                    {
                        "agent_id": entry.name,
                        "tools_count": count,
                        "path": str(tool_file),
                    }
                )
    _emit({"ok": True, "user_tools_dir": str(utd) if utd else None, "agents": agents})


def _detect_compose_cmd(override: str | None) -> list[str]:
    """Pick a compose command: --compose-cmd override, else docker/podman/legacy."""
    if override:
        return override.split()
    if shutil.which("docker"):
        return ["docker", "compose"]
    if shutil.which("podman"):
        return ["podman", "compose"]
    if shutil.which("docker-compose"):
        return ["docker-compose"]
    raise BuilderError(
        "No docker/podman compose command on PATH (needed to exec the container's "
        "ibmi). Pass --compose-cmd, or introspect another way."
    )


def cmd_ibmi(args: argparse.Namespace) -> None:
    """Run the container's `ibmi` CLI against the resolved managed system.

    Execs `<compose> -f ~/.ixora/docker-compose.yml exec -T api-<id> ibmi <args>`,
    so introspection uses the IBM i creds the ixora stack is deployed with (the api
    container's IBMI_* env) — the EXACT system the agent queries at run time. This
    is why you never call the host `ibmi`: its ~/.ibmi registry is independent of
    ixora and may point at a different box. Output passes through verbatim (not a
    JSON envelope); add `--raw` to the ibmi args for JSON.
    """
    target = _resolve_target(args)
    if target.kind != "managed" or not target.system_id:
        _emit(
            {
                "ok": False,
                "error": (
                    f"container ibmi needs a managed system (resolved kind="
                    f"{target.kind!r}); external/url systems have no local container. "
                    "Introspect via that AgentOS's own agents/tools, or build a "
                    "toolset-only agent."
                ),
            }
        )
    ixora_dir = _ixora_dir(args)
    compose_file = ixora_dir / "docker-compose.yml"
    if not compose_file.is_file():
        _emit({"ok": False, "error": f"compose file not found: {compose_file}"})
    ibmi_args = list(args.ibmi_args or [])
    if ibmi_args and ibmi_args[0] == "--":
        ibmi_args = ibmi_args[1:]
    if not ibmi_args:
        _emit(
            {
                "ok": False,
                "error": "no ibmi args given — e.g. `ibmi --system <id> -- schemas`.",
            }
        )
    compose_cmd = _detect_compose_cmd(getattr(args, "compose_cmd", None))
    cmd = [
        *compose_cmd,
        "-f",
        str(compose_file),
        "exec",
        "-T",
        f"api-{target.system_id}",
        "ibmi",
        *ibmi_args,
    ]
    try:
        proc = subprocess.run(cmd)  # inherit stdio — ibmi prints its own output
    except FileNotFoundError as exc:
        _emit({"ok": False, "error": f"failed to run {compose_cmd[0]!r}: {exc}"})
        return  # unreachable: _emit raises — present so the type checker sees it
    raise SystemExit(proc.returncode)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _add_target_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("--system", help="Target a configured system by id")
    p.add_argument("--url", help="Target this AgentOS URL directly (escape hatch)")
    p.add_argument("--key", help="Bearer key override (else SYSTEM_<ID>_AGENTOS_KEY)")
    p.add_argument("--timeout", type=int, default=30, help="HTTP timeout (seconds)")
    p.add_argument(
        "--user-tools-dir",
        help="Override the host user_tools dir (required for external targets that "
        "write custom SQL tools)",
    )
    p.add_argument("--ixora-dir", help="Override ~/.ixora (testing)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agent_builder.py",
        description="Build/register/update IBM i agents on a running Ixora stack.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("resolve", help="Print the resolved endpoint + user_tools dir")
    _add_target_flags(p)
    p.set_defaults(func=cmd_resolve)

    p = sub.add_parser("create-tool-yaml", help="Validate + write a SQL-tool YAML")
    p.add_argument("--agent-id", required=True)
    p.add_argument(
        "--yaml-file", required=True, help="Path to the YAML file, or '-' for stdin"
    )
    p.add_argument(
        "--emit-stdout",
        action="store_true",
        help="Validate and print the YAML instead of writing it",
    )
    _add_target_flags(p)
    p.set_defaults(func=cmd_create_tool_yaml)

    p = sub.add_parser("register", help="Register a new agent component")
    p.add_argument("--agent-id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--instructions")
    p.add_argument("--instructions-file")
    p.add_argument(
        "--model", help="provider:model-id (default: anthropic:claude-sonnet-4-6)"
    )
    p.add_argument(
        "--db-id", required=True, help="Registry db id (ixora status --json)"
    )
    p.add_argument("--toolsets", help="Comma-separated curated toolset names")
    p.add_argument("--stage", default="published", choices=["published", "draft"])
    p.add_argument(
        "--options-json",
        help="JSON object (or @file) of §2–§5 knobs: num_history_runs, "
        "add_history_to_context, session_state, add_session_state_to_context, "
        "enable_agentic_state, enable_agentic_memory, update_memory_on_run, "
        "component_id, metadata, config_overrides",
    )
    _add_target_flags(p)
    p.set_defaults(func=cmd_register)

    p = sub.add_parser("update", help="Edit fields of an existing agent (new version)")
    p.add_argument("component_id")
    p.add_argument(
        "--agent-id", required=True, help="YAML dir name (for scope refresh)"
    )
    p.add_argument("--name")
    p.add_argument("--description")
    p.add_argument("--instructions")
    p.add_argument("--instructions-file")
    p.add_argument("--model")
    p.add_argument("--db-id")
    p.add_argument(
        "--toolsets", help="Comma-separated; triggers a dependencies refresh"
    )
    p.add_argument("--stage", default="published", choices=["published", "draft"])
    p.add_argument("--notes", default="full-field update via skill")
    p.add_argument("--options-json", help="JSON object (or @file) of §2–§5 knobs")
    _add_target_flags(p)
    p.set_defaults(func=cmd_update)

    p = sub.add_parser(
        "update-scope", help="Swap an agent's toolsets only (new version)"
    )
    p.add_argument("component_id")
    p.add_argument("--agent-id", required=True)
    p.add_argument("--toolsets", required=True, help="Comma-separated toolset names")
    _add_target_flags(p)
    p.set_defaults(func=cmd_update_scope)

    p = sub.add_parser("list", help="List skill-built agents under user_tools/")
    _add_target_flags(p)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser(
        "ibmi",
        help="Run the container's ibmi CLI against the ixora-configured system",
    )
    p.add_argument(
        "--compose-cmd", help="Override compose command (e.g. 'podman compose')"
    )
    _add_target_flags(p)
    p.add_argument(
        "ibmi_args",
        nargs=argparse.REMAINDER,
        help="ibmi args after `--` (e.g. -- schemas | -- tables QSYS2 | -- validate '<sql>')",
    )
    p.set_defaults(func=cmd_ibmi)

    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except BuilderError as exc:
        _emit({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
