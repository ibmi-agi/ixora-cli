# Agent config — the 5-section form & the `/components` contract

> `register` / `update` assemble a config dict and POST it to the AgentOS components API; the stack rebuilds a live `Agent` from it via `IxoraRegistry.rehydrate_function`. Some keys are a **byte-for-byte contract** (mirrored from `ixora/agents/tools/builder.py`) — the script owns them; don't hand-write them.

## The config the script assembles

```jsonc
{
  "name", "description", "instructions",
  "model": { "id", "name", "provider" },              // from your provider:model-id
  "db":           { "id": "<registry-db-id>" },        // OWNED
  "dependencies": { "ibmi_toolsets":[…],               // OWNED — per-agent scope
                    "ibmi_extra_tools":[…],            //   derived from tools.yaml
                    "ibmi_extra_inventory":[…] },
  "tools":        [ {validate_and_run_sql}, … ],       // OWNED — fixed IBM i toolkit
  // + any §2–§5 knobs you set
}
```

**Owned keys = `tools`, `dependencies`, `db`.** The script wires them (the fixed `tools` list is the rehydration contract — the stack restores the live functions, incl. confirmation gates, by name). Passing any of them in `config_overrides` strips them, reported as `stripped_overrides`.

## The 5 sections

| § | Fields | How to set |
|---|---|---|
| **1 Basics** | `--agent-id`, `--name`, `--description`, `--instructions[-file]`, `--model` (`provider:model-id`), `--toolsets a,b` (optional), `--db-id` (required) | flags |
| **2 Context** | `num_history_runs`, `add_history_to_context` | `--options-json` |
| **3 Session** | `session_state`, `add_session_state_to_context`, `enable_agentic_state` | `--options-json` |
| **4 Memory** | `enable_agentic_memory` **XOR** `update_memory_on_run` | `--options-json` |
| **5 Advanced** | `component_id`, `metadata`, `config_overrides` (other safe `Agent` kwargs, e.g. `markdown`, `cache_session`) | `--options-json` |

§2–§5 travel in `--options-json` (inline JSON or `@file`); only keys present are applied — omit to inherit Agno defaults. Example:
`'{"num_history_runs":5,"add_history_to_context":true,"enable_agentic_memory":true}'`

**Instructions:** tell the new agent to *prefer its named YAML tools, fall back to `validate_and_run_sql`* only when none fit; name the domain and when to use each tool.

## Mistakes

- `enable_agentic_memory` and `update_memory_on_run` are mutually exclusive (rejected if both set).
- `session_state` / `metadata` / `config_overrides` are JSON **objects**.
- `model` is `provider:model-id` (e.g. `anthropic:claude-sonnet-4-6`), never a bare name.
- **Stage:** `register`/`update` default to `--stage published` (served immediately). `--stage draft` saves without serving — a draft won't appear in `ixora agents list` (served agents only) though it does show in `ixora components list` (all components); re-run with `--stage published` to serve it.

## Register & update

```bash
uv run "$AB" register --agent-id active-jobs --name "Active Jobs" --description "…" \
  --instructions-file ~/.ixora/user_tools/active-jobs/instructions.md --db-id "$DB_ID" --system <id> \
  [--toolsets a,b] [--model anthropic:claude-sonnet-4-6] [--options-json '{…}']

uv run "$AB" update <component_id> --agent-id active-jobs \
  --instructions-file ~/.ixora/user_tools/active-jobs/instructions.md --system <id>
uv run "$AB" update-scope <component_id> --agent-id active-jobs --toolsets perfdata,daily_health --system <id>
```

`update`/`update-scope` fetch the current config, change only what you pass (re-checking memory exclusivity), never touch the tool list, and publish a new version. Editable = builder-made (DB-backed) only; built-in agents fail the fetch.

**Toolset-only agents:** skip `create-tool-yaml`, `register` with `--toolsets a,b` and no `tools.yaml` (a missing file is fine — `ibmi_extra_tools` stays empty).

## See also
- [`tool-yaml.md`](tool-yaml.md) — author the custom tools first
- [`hardening.md`](hardening.md) — probe-test after registering
