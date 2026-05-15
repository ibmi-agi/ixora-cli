# Traces and Sessions — `ixora traces` / `ixora sessions`

These are the **debugging surface**. A **trace** captures one invocation (with all its spans — model calls, tool calls, sub-agent calls). A **session** is the conversation container; a session has zero or more **runs**, each producing one or more traces.

> Both command families target the resolved system. Use `--system <id>` to pick a specific one.

## traces

Four subcommands: `list`, `get`, `stats`, `search`.

### traces list

```
ixora traces list [options]

  --run-id <id>       filter by run ID (single invocation inside a session)
  --session-id <id>   filter by session ID (conversation)
  --user-id <id>      filter by user
  --agent-id <id>     filter by agent member (e.g. toystore-analytics-analyst)
  --team-id <id>      filter by team
  --status <status>   OK | ERROR (exact match)
  --limit <n>         page size (default 20)
  --page <n>          page number (default 1)
  --db-id <id>        database ID (only if multi-DB)
```

Each row includes `trace_id`, `name`, `status`, `duration`, `total_spans`, `error_count`, `start_time`, `end_time`, `created_at`, and (when available) `input`, `run_id`, `session_id`, `user_id`, `agent_id`, `team_id`.

Response includes a `meta` block with `page`, `limit`, `total_pages`, `total_count`, `search_time_ms`.

```bash
# last 5 traces on a team
ixora traces list --team-id ibmi-dash-toystore --limit 5

# errors only
ixora traces list --status ERROR --limit 20

# one user's last page
ixora traces list --user-id ajshedivyaj@gmail.com --limit 50

# all traces for a single run
ixora traces list --run-id ee7a0342-5699-47fb-83b9-af1a14c8e27d

# just the IDs for scripting
ixora traces list --limit 20 --json trace_id,run_id,input
```

### traces get

```
ixora traces get <trace_id> [--db-id <id>]
```

Returns the full trace envelope plus a `tree` array representing the span hierarchy. Fields: `trace_id`, `name`, `status`, `duration`, `start_time`, `end_time`, `total_spans`, `error_count`, `tree`.

**Gotcha**: `tree` can be empty (`[]`) when the underlying spans weren't persisted in hierarchical form. The top-level trace still has all the metadata; use `traces list --run-id <run_id>` to enumerate related traces instead.

### traces stats

Aggregated counts / durations / token totals over a filter.

```
ixora traces stats [options]

  --user-id <id>      filter by user
  --agent-id <id>     filter by agent
  --team-id <id>      filter by team
  --workflow-id <id>  filter by workflow
  --start-time <ts>   ISO time filter
  --end-time <ts>     ISO time filter
  --limit <n>         page size
  --page <n>          page number
  --db-id <id>        database ID
```

No `--group-by` — that's on `traces search`. Use `stats` for rollups like "how many runs did team X do this week + total tokens".

### traces search

Free-form filter + optional grouping.

```
ixora traces search [options]

  --filter <json>       JSON filter (pass-through to API)
  --group-by <field>    run | session
  --limit <n>           page size (default 20)
  --page <n>            page number
  --db-id <id>          database ID
```

`--group-by session` collapses rows to one per session with `total_traces`, `first_trace_at`, `last_trace_at`. Useful for "which sessions has this team been active in?".

```bash
# sessions sorted by recency
ixora traces search --group-by session --limit 20

# raw JSON filter (pass-through to API)
ixora traces search --filter '{"agent_id": "toystore-analytics-analyst"}'
```

## sessions

A **session** is a conversation container. Each session has zero or more **runs** (single agent/team/workflow invocations). Sessions belong to a user or are anonymous.

### sessions list

```
ixora sessions list [options]

  --type <type>         agent | team | workflow
  --component-id <id>   filter by agent/team/workflow ID
  --user-id <id>        filter by user
  --limit <n>           page size (default 20)
  --page <n>            page number
  --sort-by <field>     sort key
  --sort-order asc|desc
  --db-id <id>          database ID
```

Fields: `session_id`, `session_name`, `session_type`, `session_state`, `created_at`, `updated_at`, `user_id`, `agent_id` | `team_id` | `workflow_id`, `metrics` (token counts per model).

### sessions get / runs / create / update / delete

```bash
ixora sessions get <session_id>                  # full state incl. messages
ixora sessions runs <session_id>                 # every run in the session
ixora sessions create --type team --component-id ibmi-team --name "Debug session" --user-id me
ixora sessions update <id> --name "new name" --state '{"foo":"bar"}' --metadata '{"tag":"dev"}'
ixora sessions delete <id>
ixora sessions delete-all                        # bulk (reads filter flags)
```

`sessions update` accepts `--name`, `--state <json>`, `--metadata <json>`, `--summary <text>`.

### Recipes

```bash
# latest 10 sessions for a team
ixora sessions list --type team --component-id ibmi-dash-toystore --limit 10

# all runs in a session
ixora sessions runs 6d9db701-39e7-4ccc-b989-6f1a72970ad6

# my sessions, sorted newest first
ixora sessions list --user-id ajshedivyaj@gmail.com --sort-by created_at --sort-order desc
```

## Debugging a failed run (concrete workflow)

The fastest path from "something broke" to "I see why":

1. **Trigger or recall the run.** If you have the team ID:
   ```bash
   ixora teams run ibmi-dash-toystore "Monthly revenue for 1997" --stream
   ```
2. **Grab the session_id and run_id** from the streamed output, or pull the latest trace:
   ```bash
   ixora traces list --team-id ibmi-dash-toystore --limit 1 \
     --json session_id,run_id,trace_id,input
   ```
3. **See every trace inside that session**:
   ```bash
   ixora traces list --session-id <session_id> --limit 50
   ```
4. **Zoom into one trace**:
   ```bash
   ixora traces get <trace_id>
   ```
5. **If a team member seems to have skipped a step**, filter to just that member:
   ```bash
   ixora traces list --session-id <session_id> --agent-id toystore-analytics-engineer
   ```
6. **If the failure is below the AgentOS layer** (network, MCP, container restart), tail container logs:
   ```bash
   ixora stack logs agentos-api
   ixora stack logs ibmi-mcp-server
   ```

## Span-tree interpretation

When `tree` is populated, each node has the shape:

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

Tool-call names (`MCPTools.call_tool.<tool_name>`) are where tool-usage bugs surface — missing tool calls, duplicated calls, wrong tool selected. Tally them to diagnose routing.

## Sessions vs traces — when to reach for which

| Need | Use |
|---|---|
| "What was the user-visible conversation?" | `ixora sessions get <id>` |
| "What invocations happened in this session?" | `ixora sessions runs <id>` |
| "What did the agent/tools actually do during one invocation?" | `ixora traces get <trace_id>` |
| "Was there an error?" | `ixora traces list --status ERROR` |
| "How much did team X spend on tokens this week?" | `ixora traces stats --team-id ...` |
