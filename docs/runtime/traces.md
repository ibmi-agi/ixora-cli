# `ixora traces`

Inspect agent/team/workflow run traces.

```bash
ixora traces list
ixora traces get <trace_id>
ixora traces stats
ixora traces search --filter '<json>'
```

All subcommands accept `--db-id <id>` to scope to a specific database.

---

## `list`

```bash
ixora traces list
ixora traces list --status error
ixora traces list --agent-id sql-agent --limit 50
ixora traces list --user-id alice --json trace_id,status,duration
```

| Flag | Purpose |
|---|---|
| `--run-id <id>` | Filter by run ID |
| `--session-id <id>` | Filter by session ID |
| `--user-id <id>` | Filter by user ID |
| `--agent-id <id>` | Filter by agent ID |
| `--status <s>` | Filter by status (e.g. `ok`, `error`, `running`, `cancelled`) |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |
| `--db-id <id>` | Database ID |

Output columns: `TRACE_ID`, `NAME`, `STATUS`, `DURATION`, `START_TIME`.

---

## `get <trace_id>`

```bash
ixora traces get trc_abc
ixora traces get trc_abc --json
```

Default fields: `Trace ID`, `Name`, `Status`, `Duration`, `Start Time`, `End Time`, `Error`. JSON output includes the full tree of spans, tool calls, prompts, and responses.

| Flag | Purpose |
|---|---|
| `--db-id <id>` | Database ID |

---

## `stats`

Aggregate counts grouped by session / user / agent.

```bash
ixora traces stats
ixora traces stats --agent-id sql-agent
ixora traces stats --start-time 2026-05-01 --end-time 2026-05-15
```

| Flag | Purpose |
|---|---|
| `--user-id <id>` | Filter |
| `--agent-id <id>` | Filter |
| `--team-id <id>` | Filter |
| `--workflow-id <id>` | Filter |
| `--start-time <t>` | Start of the time window |
| `--end-time <t>` | End of the time window |
| `--limit <n>` | Page size |
| `--page <n>` | Page number |
| `--db-id <id>` | Database ID |

Output columns: `SESSION_ID`, `USER_ID`, `AGENT_ID`, `TOTAL_TRACES`, `FIRST_TRACE`, `LAST_TRACE`.

---

## `search`

Free-form filter expression. The `--filter` value is a JSON object passed to the server's search endpoint.

```bash
ixora traces search --filter '{"status":"error","agent_id":"sql-agent"}'
ixora traces search --filter '{"duration_gt":10000}' --group-by session
```

| Flag | Purpose |
|---|---|
| `--filter <json>` | Filter object as JSON |
| `--group-by <field>` | Group results: `run`, `session` |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |
| `--db-id <id>` | Database ID |

Invalid JSON errors out client-side. Output columns: `TRACE_ID`, `NAME`, `STATUS`, `DURATION`.

---

## Example workflows

### List all failures from the last hour

```bash
ixora traces list --status error --json trace_id,name,start_time
```

### Tally usage per agent for the week

```bash
ixora traces stats --start-time 2026-05-08 --end-time 2026-05-15 --json \
  | jq '.data[] | {agent_id, total_traces}'
```

### Find slow runs

```bash
ixora traces search --filter '{"duration_gt": 30000}' --json trace_id,duration
```

---

## See also

- [`agents.md`](agents.md) — get a `run_id` to pass as `--run-id`
- [`sessions.md`](sessions.md) — list every run in a session (`ixora sessions runs <id>`)
- [`metrics.md`](metrics.md) — aggregated daily counts (lower granularity, higher level)
