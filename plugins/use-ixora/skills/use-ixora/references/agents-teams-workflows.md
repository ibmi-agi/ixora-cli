# Agents, Teams, Workflows — `ixora {agents,teams,workflows}`

> **For exact flags, run `ixora {agents,teams,workflows} <verb> --help`.** This reference covers workflows, gotchas, and verb-shape differences — it does not transcribe every flag.

All three share the same verb set: `list`, `get`, `run`, `continue`, `cancel`. Each command targets the resolved system (see system resolution in `SKILL.md` or [systems.md](systems.md)).

**Targeting**: every command accepts `--system <id>` to pick a specific system. Omit it to use the implicit pick / configured default. `--url <url>` skips resolution entirely (one-off probe against an unregistered endpoint).

## list

```bash
ixora {agents|teams|workflows} list                    # paginated; --limit / --page
ixora agents list --json id,name                       # JSON projection for scripting
ixora --system prod teams list
```

Returned fields: `id`, `name`, `description`, `db_id`. Teams also have `mode` (`coordinate` | `route` | `broadcast`). Workflows have `is_factory` / `is_component` flags.

## get

```bash
ixora {agents|teams|workflows} get <id>
```

Full component details: instructions, tools, model config (where exposed). For teams, `get` returns the member list — useful for routing diagnostics without invoking the team.

## run

Single positional `<message>`; common options `--stream`, `--session-id <id>`, `--user-id <id>`.

```bash
# one-shot
ixora agents run ibmi-system-health "Full system health check"

# stream live progress (SSE events: run.started, run.content, run.tool_call, run.tool_result, run.completed)
ixora teams run ibmi-team "Audit security on the prod LPAR" --stream

# continue a conversation by reusing the session ID
ixora agents run ibmi-text2sql "What are the top 5 by revenue?" \
  --session-id 6d9db701-39e7-4ccc-b989-6f1a72970ad6

# workflow run
ixora workflows run security-assessment-v2 "Audit production"

# target a specific system
ixora --system dev agents run ibmi-text2sql "Show me CUSTOMERS schema"
```

Quote the message — it's a single positional string. With `--stream` the CLI prints `event:` / `data:` SSE pairs; without it you get the final response as one JSON blob.

## continue — verb shape differs by command

`continue` resumes a run that paused for human input (tool approval, clarifying question). The argument list and convenience flags differ across the three:

```bash
# agents: optional tool_results — or use --confirm / --reject for paused tool calls
ixora agents continue <agent_id> <run_id>                                    # interactive
ixora agents continue <agent_id> <run_id> --confirm                          # approve & resume
ixora agents continue <agent_id> <run_id> --reject "wrong table"             # reject with note
ixora agents continue <agent_id> <run_id> '{"tool_call_id":"...","output":"..."}'   # raw payload

# teams + workflows: required <message>, no --confirm/--reject
ixora teams     continue <team_id>     <run_id> "<message>" [--stream]
ixora workflows continue <workflow_id> <run_id> "<message>"
```

`--confirm` and `--reject` are agent-only. They reconstruct the paused tool-call payload from a local cache so you don't have to hand-build `tool_results` JSON. Pair with `ixora approvals resolve` if the pause originated from an approvals workflow.

The non-stream `continue` result honors `--json fields` projection as of v0.3.3 — `ixora agents continue <id> <run> --confirm --json run_id,session_id` returns just those fields, same as `get`/`list`. (With `--stream`, the SSE event stream is unaffected.)

### `--confirm` / `--reject` cache prerequisite

The cache that `--confirm` / `--reject` read from is written **only when the original `agents run` (or a prior `continue`) observed a paused event with tools** — i.e. you ran the agent and it actually paused waiting for human approval. It lives at:

```
~/.ixora/agentos-paused-runs/<run_id>.json
```

Cache entries **expire after 24 hours**. If the cache is missing or stale, `agents continue --confirm` errors with:

```
No cached paused state for run <run_id>. Provide tool results JSON
directly or re-run the agent with --stream to capture the paused state.
```

Recovery options when the cache isn't there:

```bash
# 1. Pass raw tool_results JSON as the positional arg
ixora agents continue <agent_id> <run_id> '{"tool_call_id":"...","output":"..."}'

# 2. Re-run the agent to repopulate the cache, then --confirm/--reject
ixora agents run <agent_id> "<same prompt>" --stream
ixora agents continue <agent_id> <new_run_id> --confirm
```

The cache survives terminal sessions and shells — what matters is whether the run is younger than 24h and was originally observed by **this** machine's CLI (the cache is local to `~/.ixora/`, not shared from the server).

## cancel

```bash
ixora {agents|teams|workflows} cancel <component_id> <run_id>
```

Terminates an in-progress run. Useful when a loop is stuck or a streaming call was abandoned.

## Tips

- After a `run`, find the freshly-minted IDs with `ixora traces list --limit 1 --json trace_id,run_id,session_id,input` — useful for chaining into `traces get` or `sessions runs`.
- For team routing diagnostics (who did the leader hand off to?), filter `traces list --agent-id <member_id>` for that member's traces. `traces list` has no `--team-id` filter — for a per-trace team view use `traces search --filter '{"team_id":"<id>"}'`.
- The CLI has no `--response-model` for structured output. Hit the HTTP API directly or use `@worksofadam/agentos-sdk`.
