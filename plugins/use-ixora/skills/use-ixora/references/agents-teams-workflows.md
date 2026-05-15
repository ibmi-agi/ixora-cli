# Agents, Teams, Workflows — `ixora {agents,teams,workflows}`

All three share the same verb set: `list`, `get`, `run`, `continue`, `cancel`. All target the resolved system (see system resolution in `SKILL.md` or [systems.md](systems.md)).

> **Targeting**: every command accepts `--system <id>` to pick a specific system. Omit it to use the implicit pick / configured default. `--url <url>` skips resolution entirely.

## list

```bash
ixora {agents|teams|workflows} list [--limit <n>] [--page <n>]
```

Returns `id`, `name`, `description`, `db_id`. Teams also have `mode` (`coordinate` | `route` | `broadcast`). Workflows have `is_factory` and `is_component` flags.

```bash
ixora agents list                                  # all agents
ixora agents list --json id,name                   # JSON projection for scripting
ixora --system prod teams list --limit 5
```

## get

```bash
ixora {agents|teams|workflows} get <id>
```

Full component details including instructions, tools, model config (where exposed).

## run

```bash
ixora agents    run <agent_id>    <message> [--stream] [--session-id <id>] [--user-id <id>]
ixora teams     run <team_id>     <message> [--stream] [--session-id <id>] [--user-id <id>]
ixora workflows run <workflow_id> <message> [--stream] [--session-id <id>] [--user-id <id>]
```

- `--stream` / `-s` — consume SSE events live. Without it, you get the final response as a single JSON blob.
- `--session-id` — thread conversation context. Reuse an existing session ID to continue a chat; omit to start a new session.
- `--user-id` — tag the run for per-user memory/metrics.
- `<message>` is a single positional string. Quote it.

### Recipes

```bash
# one-shot, get full response
ixora agents run ibmi-system-health "Full system health check"

# stream so you see progress
ixora teams run ibmi-team "Audit security on the prod LPAR" --stream

# continue a conversation
ixora agents run ibmi-text2sql "What are the top 5 by revenue?" \
  --session-id 6d9db701-39e7-4ccc-b989-6f1a72970ad6

# run a workflow
ixora workflows run security-assessment-v2 "Audit production"

# target a specific system
ixora --system dev agents run ibmi-text2sql "Show me CUSTOMERS schema"
```

## continue

Continue a run that requested human input (tool approval, clarifying question).

```bash
ixora agents    continue <agent_id>    <run_id> [tool_results] [options]
ixora teams     continue <team_id>     <run_id> <message>        [options]
ixora workflows continue <workflow_id> <run_id> <message>        [options]
```

Shape differs by command:
- **agents** `continue` takes optional `tool_results` (for tool approvals).
- **teams** and **workflows** `continue` take a required `message`.

This pairs with `ixora approvals resolve` for human-in-the-loop flows.

## cancel

```bash
ixora {agents|teams|workflows} cancel <component_id> <run_id>
```

Terminates an in-progress run. Useful when a loop is stuck or a streaming call got abandoned.

## Streaming output shape

With `--stream`, the CLI prints SSE events to stdout. Abbreviated:

```
event: run.started
data: {"run_id": "...", "component_id": "...", ...}

event: run.content
data: {"content": "Hello, ..."}

event: run.tool_call
data: {"name": "execute_sql", "arguments": {...}}

event: run.tool_result
data: {"name": "execute_sql", "result": "..."}

event: run.completed
data: {"run_id": "...", "content": "<final>", ...}
```

For scripted consumers, parse each `event:` line and the subsequent `data:` JSON.

## Structured output

The CLI doesn't expose a `--response-model` flag. For structured output, hit the HTTP API directly or use the `@worksofadam/agentos-sdk` Node package.

## Tips

- After a `run`, the latest run + session IDs are visible via `ixora traces list --limit 1 --json trace_id,run_id,session_id,input` — useful for chaining into `traces get` or `sessions runs`.
- For routing diagnostics on a team run (who did the leader hand off to?), filter `traces list` by `--agent-id <member_id>` to see just that member's spans.
- To list every member of a team without running it, `ixora teams get <id>` returns the member list under `members` / `agent_ids`.
