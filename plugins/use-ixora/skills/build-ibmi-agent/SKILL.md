---
name: build-ibmi-agent
description: >
  Build, register, update, and harden a custom IBM i agent on a running Ixora
  stack — the coding-agent counterpart of Ixora's in-app agent-builder agent.
  It introspects the IBM i system through the stack's own bundled `ibmi` CLI,
  designs validated SQL-tool YAML, and registers the agent via the AgentOS
  components API (no source edits, no restart), then probe-tests it. Use when
  the user wants to build / create / scaffold / register / add a new Ixora
  agent, make a custom IBM i (Db2 for i) SQL agent, build an agent for the
  ixora stack, or update / improve / harden one they already registered. NOT
  the workbench `ibmi-agent-builder` skill (that scaffolds a standalone local
  app); this targets a running stack's components API.
allowed-tools: Bash(ixora:*), Bash(uv:*), Bash(python3:*), Bash(docker:*), Bash(podman:*), Bash(which:*), Bash(command:*), Bash(cat:*), Bash(ls:*), Bash(grep:*), Bash(jq:*), Bash(find:*)
---

# build-ibmi-agent

Build a custom IBM i agent the way Ixora's in-app agent-builder agent does, but driven by you: introspect the target IBM i, design SQL tools, and **register the agent via the AgentOS components API** — DB-backed, runnable immediately, no restart. Output: a registered component (`ixora components list`) plus its validated `tools.yaml` in the stack's `user_tools/`.

The bundled `scripts/agent_builder.py` (`$AB` below) handles the fragile parts — schema validation, the components config contract, and the API calls — so your work is the IBM i design and the confirmations.

## Two CLIs — keep them straight

| Tool | Role | How you call it |
|---|---|---|
| **`ixora`** | platform CLI — stack status, `--db-id` (`ixora status`), and `components`/`agents`/`traces` for verify & run | `ixora …` (host) |
| **container `ibmi`** | query the IBM i system while designing tools (schemas/tables/columns/validate/sql) | `uv run "$AB" ibmi --system <id> -- …` |
| **`$AB`** | this script — validate YAML, register/update agents, and the `ibmi` passthrough | `uv run "$AB" <sub> …` |

**Reach IBM i through `$AB ibmi`, never the host `ibmi`.** The host `ibmi` has its own `~/.ibmi` registry, independent of Ixora and possibly a different box. `$AB ibmi` execs the `ibmi` binary *inside the stack's `api-<id>` container*, which uses the creds Ixora deploys with — so what you introspect is what the agent queries at run time. (Container `ibmi` exists for **managed** systems only.)

## Preflight

`scripts/agent_builder.py` sits beside this SKILL.md. Resolve its **absolute path** from where this skill lives and use it as `$AB` — shells don't carry variables between commands, so re-assign `AB=…` per command or paste the path.

```bash
AB="/absolute/path/to/build-ibmi-agent/scripts/agent_builder.py"
command -v uv || command -v python3        # uv preferred — auto-installs the script's deps
ixora stack status                         # a stack must be running
uv run "$AB" --help                        # see every subcommand (then <sub> --help for its flags)
uv run "$AB" resolve --system <id>         # endpoint, user_tools dir, ibmi_via hint
```

`uv run` auto-installs the deps (`pyyaml`, `jsonschema`) via the script's PEP 723 header; with plain `python3`, `pip install pyyaml jsonschema` first. Can't locate the script? The skill isn't fully installed — say so and stop.

## Build an agent

Design the tools, then fill the config. **Confirm with the user before writing the YAML, and again before registering.**

1. **Clarify** what the agent does and which data it needs. (No custom SQL — only curated toolsets? Skip to step 4 for a toolset-only agent.)
2. **Introspect** the real schema through the container `ibmi` — don't guess names (`--raw` for JSON):
   ```bash
   uv run "$AB" ibmi --system <id> -- schemas
   uv run "$AB" ibmi --system <id> -- tables <SCHEMA>
   uv run "$AB" ibmi --system <id> -- columns <SCHEMA> <TABLE>
   uv run "$AB" ibmi --system <id> -- validate "<candidate SQL>"
   ```
3. **Design read-only, parameterized tools** (`:param`, `security.readOnly: true`), show the user a tool table, then **validate & write** — fix what it reports and re-run until it passes:
   ```bash
   uv run "$AB" create-tool-yaml --agent-id <agent-id> --yaml-file ./tools.yaml --system <id>
   ```
   Schema + the gotchas the validator catches: [`references/tool-yaml.md`](references/tool-yaml.md).
4. **Write the instructions, then assemble the config.** Co-locate the instructions with the agent's tools: `~/.ixora/user_tools/<agent-id>/instructions.md` (the per-agent folder `create-tool-yaml` already creates; `mkdir -p` it for a toolset-only agent). Tell the agent to *prefer its named tools, fall back to `validate_and_run_sql`*. Then gather `--model` (default `anthropic:claude-sonnet-4-6`) and `--db-id` (`ixora status --system <id> --json | jq -r '.databases[]?'`). Before setting anything past the basics (history, memory, session state, overrides), read [`references/agent-config.md`](references/agent-config.md) — field meanings + the owned-keys contract.
5. **Show the full config, get explicit confirmation, then register:**
   ```bash
   uv run "$AB" register --agent-id <agent-id> --name "<Name>" --description "<…>" \
     --instructions-file ~/.ixora/user_tools/<agent-id>/instructions.md --db-id "$DB_ID" --system <id>
   ```

### Verify
```bash
ixora components list --system <id>
RID=$(ixora agents run "<component_id>" "<a real question>" --bypass-confirmations --json | jq -r .run_id)
ixora traces get "$RID"          # did the right tools fire?
```

## Update / improve

- **Edit a field or toolset:** edit `~/.ixora/user_tools/<agent-id>/instructions.md`, then `uv run "$AB" update <component_id> --agent-id <id> --instructions-file ~/.ixora/user_tools/<agent-id>/instructions.md --system <id>` (or `update-scope … --toolsets a,b`). New config version, no restart; the tool list is never touched. Contract in [`references/agent-config.md`](references/agent-config.md).
- **Harden it:** the probe → judge → fix loop in [`references/hardening.md`](references/hardening.md) — load it when the user wants the agent tested or improved.

Only builder-made (DB-backed) agents are editable — find them with `uv run "$AB" list` or `ixora components list`.

## Script subcommands

`uv run "$AB" <sub>` prints a JSON envelope and exits 0/1: `resolve` · `ibmi` (container passthrough) · `create-tool-yaml` · `register` · `update` · `update-scope` · `list`. Run `uv run "$AB" --help` for the list and `uv run "$AB" <sub> --help` for a subcommand's exact flags — prefer that over inferring flags from this doc. Target with `--system <id>` or `--url`; resolution details in [`references/endpoint-resolution.md`](references/endpoint-resolution.md).

## Gotchas

- **Never the host `ibmi`** — go through `$AB ibmi` so introspection hits the stack's IBM i box (see Two CLIs). It's managed-systems only; for external systems, introspect via that AgentOS's own agents or build toolset-only.
- **`tools` / `dependencies` / `db` are owned by the script** — the rehydration contract the Ixora app relies on. Don't hand-write them; passing them via `config_overrides` strips them (`stripped_overrides`).
- **`stage: draft` agents aren't served** until published — they won't appear in `ixora agents list`.
- **External / `--url` systems can't auto-write `tools.yaml`** (host path unknown) — pass `--user-tools-dir`, deliver it out-of-band, or go toolset-only.
- **`--bypass-confirmations` is required when probing** — the SQL tools gate on confirmation, so a run otherwise pauses (exit 4) instead of finishing.
- **`agent_id` must be unique on the host** — it's the `tools.yaml` dir and the component-id prefix; `user_tools/` is shared across managed systems.
- **An agent's editable source is `~/.ixora/user_tools/<agent_id>/`** — `tools.yaml` + `instructions.md` together. `register`/`update` copy the instructions into the component config (the runtime source of truth); the `.md` rides along in the bind-mount but the container only reads `tools.yaml`.
- **If a registered agent won't run,** suspect contract drift between `$AB` / `assets/sql-tools-config.schema.json` and `ixora/agents/tools/builder.py`: diff a skill-built config (`ixora components get`) against one from the in-app builder. See [`assets/SOURCES.md`](assets/SOURCES.md).
