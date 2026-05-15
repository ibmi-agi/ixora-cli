# Traces and Sessions — `ixora traces` / `ixora sessions`

> **For exact flags, run `ixora traces <verb> --help` and `ixora sessions <verb> --help`.** This reference covers workflows, gotchas, and non-obvious patterns — it does not transcribe every flag.

These are the **debugging surface**. A **trace** captures one invocation (with all its spans — model calls, tool calls, sub-agent calls). A **session** is the conversation container; a session has zero or more **runs**, each producing one or more traces.

Both target the resolved system. Use `--system <id>` to pick a specific one.

## traces

Verbs: `list`, `get`, `stats`, `search`. Each has a different filter surface — they are **not** uniform.

### Filter surface — which verb supports which filter

| Filter | `list` | `stats` | `search` |
|---|---|---|---|
| `--run-id` | ✅ | — | — |
| `--session-id` | ✅ | — | — |
| `--user-id` | ✅ | ✅ | — |
| `--agent-id` | ✅ | ✅ | — |
| **`--team-id`** | **❌ — not on `list`** | ✅ | — |
| `--workflow-id` | — | ✅ | — |
| `--status` (OK \| ERROR) | ✅ | — | — |
| `--start-time` / `--end-time` (ISO) | — | ✅ | — |
| `--filter <json>` (raw API pass-through) | — | — | ✅ |
| `--group-by run\|session` | — | — | ✅ |

**Common mistake**: `traces list --team-id <id>` looks reasonable but the flag isn't registered there. To get per-trace listing for a team, either filter by a specific team member (`--agent-id <member>`), use `traces search --filter '{"team_id":"<id>"}'`, or pull a session-grouped rollup with `traces search --group-by session`.

### traces list

Newest first; paginates. Response wraps a `meta` block with `page`, `limit`, `total_pages`, `total_count`, `search_time_ms`. Each row carries `trace_id`, `name`, `status`, `duration`, `total_spans`, `error_count`, `start_time`, `end_time`, `created_at`, and (when available) `input`, `run_id`, `session_id`, `user_id`, `agent_id`, `team_id`.

```bash
ixora traces list --limit 20                                          # newest 20
ixora traces list --status ERROR --limit 50                           # errors only
ixora traces list --agent-id toystore-analytics-engineer --limit 10   # one team member
ixora traces list --user-id <user> --limit 50
ixora traces list --run-id <run_id>                                   # all traces for one run
ixora traces list --limit 20 --json trace_id,run_id,input             # IDs only for scripting
```

### traces get

```bash
ixora traces get <trace_id>
```

Returns the trace envelope plus a `tree` of spans. **Gotcha**: `tree` can be empty (`[]`) when spans weren't persisted in hierarchical form — top-level metadata is still valid. Fall back to `traces list --run-id <run_id>` to enumerate related traces.

### traces stats

Aggregated counts / durations / token totals over a filter. **Use this — not `list` — when you want a team-level rollup.** No `--group-by` here (that's on `search`).

```bash
ixora traces stats --team-id ibmi-dash-toystore
ixora traces stats --team-id ibmi-dash-toystore --start-time 2026-05-01 --end-time 2026-05-15
ixora traces stats --user-id <user> --start-time 2026-05-01

# Project specific stats fields
ixora traces stats --team-id ibmi-dash-toystore --json total_traces,total_duration,total_tokens
```

### traces search

Free-form filter + optional grouping. `--filter` is a raw JSON pass-through to the underlying API — useful for filter dims `list` doesn't expose.

```bash
ixora traces search --group-by session --limit 20                              # one row per session
ixora traces search --group-by run --limit 50                                  # one row per run
ixora traces search --filter '{"team_id":"ibmi-dash-toystore"}' --limit 20     # per-trace listing for a team
ixora traces search --filter '{"agent_id":"toystore-analytics-analyst"}'

# Project specific fields on search results
ixora traces search --filter '{"team_id":"ibmi-dash-toystore"}' --json trace_id,session_id,duration
```

## sessions

A **session** is a conversation container. Sessions belong to a user or are anonymous; each has zero or more **runs** (one agent/team/workflow invocation each).

### list / get / runs / create / update / delete

```bash
ixora sessions list --type team --component-id ibmi-dash-toystore --limit 10
ixora sessions list --user-id <user> --sort-by created_at --sort-order desc

ixora sessions get  <session_id>                                    # full state incl. messages
ixora sessions runs <session_id>                                    # every run in the session
ixora sessions runs <session_id> --json run_id,status,created_at    # project specific fields

ixora sessions create --type team --component-id ibmi-team --name "Debug" --user-id <user>
ixora sessions update <id> --name "new name" --state '{"foo":"bar"}' --metadata '{"tag":"dev"}'
ixora sessions delete <id>
```

`--type` is `agent | team | workflow`. Returned fields: `session_id`, `session_name`, `session_type`, `session_state`, `created_at`, `updated_at`, `user_id`, the matching component ID, and `metrics` (per-model token counts).

### delete-all is batch-by-ID with parallel types — NOT filter-based

```bash
ixora sessions delete-all --ids id1,id2,id3 --types team,team,agent
```

Both `--ids` and `--types` are **required**, and the arrays must be the same length (one type per ID). It is not a "delete every session matching a filter" sweep. To purge by filter:

```bash
sids=$(ixora sessions list --type team --component-id ibmi-dash-toystore --limit 200 \
       --json session_id | jq -r 'map(.session_id) | join(",")')
sct=$(ixora sessions list --type team --component-id ibmi-dash-toystore --limit 200 \
      --json session_id | jq -r 'map("team") | join(",")')
ixora sessions delete-all --ids "$sids" --types "$sct"
```

## Debugging a failed run (concrete walkthrough)

The non-obvious sequence from "something broke" to "I see why":

1. **Trigger or recall the run.** If you have the team ID:
   ```bash
   ixora teams run ibmi-dash-toystore "Monthly revenue for 1997" --stream
   ```
2. **Grab the session and run IDs** from the streamed output, or from the latest trace:
   ```bash
   ixora traces list --limit 1 --json session_id,run_id,trace_id,input
   ```
   (no `--team-id` here — `list` doesn't take it)
3. **See every trace in that session**:
   ```bash
   ixora traces list --session-id <session_id> --limit 50
   ```
4. **Zoom into one**:
   ```bash
   ixora traces get <trace_id>
   ```
5. **Filter to one team member** if a handoff looks wrong:
   ```bash
   ixora traces list --session-id <session_id> --agent-id toystore-analytics-engineer
   ```
6. **If the failure is below the AgentOS layer** (network, MCP, container restart):
   ```bash
   ixora stack logs api-<system_id>      # e.g. api-default
   ixora stack logs mcp-<system_id>      # e.g. mcp-default
   ```

## Span-tree shape

When `tree` is populated, each node looks like:

```json
{
  "span_id": "...",
  "parent_span_id": "...",
  "name": "Claude.ainvoke_stream" | "MCPTools.call_tool" | "Agent.arun" | ...,
  "status": "OK" | "ERROR",
  "duration": "12.34s",
  "attributes": { ... },
  "children": [ ... ]
}
```

Tool-call names (`MCPTools.call_tool.<tool_name>`) are where tool-usage bugs surface — missing calls, duplicated calls, wrong tool selected. Tally them to diagnose routing.

## Sessions vs traces — when to reach for which

| Need | Use |
|---|---|
| "What was the user-visible conversation?" | `ixora sessions get <id>` |
| "What invocations happened in this session?" | `ixora sessions runs <id>` |
| "What did the agent/tools actually do during one invocation?" | `ixora traces get <trace_id>` |
| "Were there any errors?" | `ixora traces list --status ERROR` |
| "How much did team X spend on tokens this week?" | `ixora traces stats --team-id <id> --start-time ...` |
| "Which sessions has team X been active in?" | `ixora traces search --filter '{"team_id":"<id>"}' --group-by session` |
