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

## Tooling — keep them straight

| Tool | Role | How you call it |
|---|---|---|
| **`ixora`** | host platform CLI — `ixora status` (the `--db-id` source), plus `components` / `agents` / `traces` to verify & run | `ixora …` (host) |
| **`$AB`** | this script — validate YAML, register/update agents, and the container-`ibmi` passthrough | `uv run "$AB" <sub> …` |

`$AB`'s `ibmi` subcommand (`uv run "$AB" ibmi --system <id> -- …`) is how you query the IBM i while designing tools — **not a third CLI**: it execs the `ibmi` binary *inside the stack's `api-<id>` container*, which uses the creds Ixora deploys with, so what you introspect is what the agent queries at run time. **Never the host `ibmi`** — its `~/.ibmi` registry is independent of Ixora and may point at a different box. (Container `ibmi` is **managed**-systems only; for external systems introspect via that AgentOS's own agents, or build toolset-only.)

## Preflight

`$AB` is `scripts/agent_builder.py` inside **this skill's own directory** — the folder you loaded this SKILL.md from. You already know that absolute path; set `AB` to `<that dir>/scripts/agent_builder.py`. Re-assign it per command (shell state doesn't persist between calls).

```bash
ixora stack system list               # <id> below = a configured system id (omit --system when only one managed system exists)
AB="<this skill's dir>/scripts/agent_builder.py"   # the directory you loaded SKILL.md from
ls "$AB" || echo "not found"          # missing? the skill isn't fully installed — say so and stop
command -v uv || command -v python3   # uv preferred — auto-installs the script's deps (pyyaml, jsonschema) via its PEP 723 header
ixora stack status                    # a stack must be running
uv run "$AB" --help                   # every subcommand (then `<sub> --help` for its flags)
uv run "$AB" resolve --system <id>    # confirm endpoint, user_tools dir, ibmi_via hint before mutating
```

With plain `python3` instead of `uv`, `pip install pyyaml jsonschema` first.

## Build an agent

Design the tools, then fill the config. **Confirm with the user before writing the YAML, and again before registering.**

1. **Clarify** what the agent does and which data it needs. (No custom SQL — only curated toolsets? Skip steps 2–3; in step 5 add `--toolsets a,b` and no `tools.yaml`.)
2. **Introspect** the real schema through `$AB ibmi` — don't guess names (append `--raw` to the ibmi args for JSON):
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
   Shape + the gotchas the validator catches: [`references/tool-yaml.md`](references/tool-yaml.md).
4. **Write the instructions, then assemble the config.** Co-locate instructions with the tools at `~/.ixora/user_tools/<agent-id>/instructions.md` — `mkdir -p` the folder first (`create-tool-yaml` makes it for a SQL-tool agent, but a toolset-only or external/`--url` agent has none yet). Tell the new agent to *prefer its named YAML tools, fall back to `validate_and_run_sql`*. Capture the registry db id (re-run per Bash call — shell state doesn't persist):
   ```bash
   DB_ID=$(ixora status --system <id> --json | jq -r '.databases[]?' | head -1)
   ```
   Before setting anything past the basics (history, memory, session state, overrides), read [`references/agent-config.md`](references/agent-config.md) — field meanings + the owned-keys contract.
5. **Show the full config, get explicit confirmation, then register.** `agent_id` is what you choose; `register` returns a server-assigned `component_id` (prefixed by your `agent_id`) in its JSON envelope — that is the runnable handle. Capture it:
   ```bash
   CID=$(uv run "$AB" register --agent-id <agent-id> --name "<Name>" --description "<…>" \
     --instructions-file ~/.ixora/user_tools/<agent-id>/instructions.md \
     --db-id "$DB_ID" --system <id> [--toolsets a,b] [--model anthropic:claude-sonnet-4-6] | jq -r .component_id)
   ```

### Verify
```bash
ixora components list --system <id>
RID=$(ixora agents run "$CID" "<a real question>" --bypass-confirmations --json | jq -r .run_id)
ixora traces get "$RID"          # span tree = ground truth: did the right tools fire?
```
`--bypass-confirmations` is required — the SQL tools gate on confirmation, so a run otherwise pauses (exit 4) instead of finishing.

## Update / improve

An agent's editable source is `~/.ixora/user_tools/<agent_id>/` — `tools.yaml` + `instructions.md` together. Only builder-made (DB-backed) agents are editable; find them with `uv run "$AB" list` (agent_ids that have a local `tools.yaml`) or `ixora components list` (the `component_id` you pass below — built-in registry agents have no editable config).

- **Edit a field or toolset:** edit `~/.ixora/user_tools/<agent-id>/instructions.md`, then `uv run "$AB" update "$CID" --agent-id <id> --instructions-file …/instructions.md --system <id>` (or `update-scope "$CID" … --toolsets a,b`). New config version, no restart; the tool list is never touched. Contract in [`references/agent-config.md`](references/agent-config.md).
- **Harden it:** the probe → judge → fix loop in [`references/hardening.md`](references/hardening.md) — load it when the user wants the agent tested or improved.

## Script subcommands

`uv run "$AB" <sub>` prints a JSON envelope and exits 0/1: `resolve` · `ibmi` (container passthrough) · `create-tool-yaml` · `register` · `update` · `update-scope` · `list`. Run `uv run "$AB" --help` for the list and `uv run "$AB" <sub> --help` for a subcommand's exact flags — prefer that over inferring flags from this doc. Target with `--system <id>` or `--url`; resolution details in [`references/endpoint-resolution.md`](references/endpoint-resolution.md).

The `ixora …` commands above are the **host platform CLI** (not `$AB`); confirm exact names/flags with `ixora --help` / `ixora <group> --help` if one errors. Note `ixora status` (AgentOS JSON config — has `.databases` for `--db-id`) is a different command from `ixora stack status` (local compose liveness).

## Gotchas

- **`tools` / `dependencies` / `db` are owned by the script** — the rehydration contract the Ixora app relies on. Don't hand-write them; passing them via `config_overrides` strips them (reported as `stripped_overrides`).
- **If a registered agent won't run,** suspect contract drift between `$AB` / `assets/sql-tools-config.schema.json` and `ixora/agents/tools/builder.py`: diff a skill-built config (`ixora components get`) against one from the in-app agent-builder agent. See [`assets/SOURCES.md`](assets/SOURCES.md).
