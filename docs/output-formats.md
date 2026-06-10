# Output Formats

Every command supports three output formats — selected automatically from the TTY, or controlled with flags.

| Format | Selected when | Looks like |
|---|---|---|
| `table` | Default in an interactive TTY | Boxed table with colored headers |
| `json`  | Default when piped (non-TTY), or explicit `--json` / `-o json` | Pretty-printed JSON to stdout |
| `compact` | Explicit `-o compact` (only for `agents run` / `agents continue`) | Single-line condensed output |

---

## `--json` vs `-o <format>`

Both work; `-o` is the canonical form and supports all three values. `--json` is a shortcut.

```bash
ixora agents list                      # auto: table in a TTY, JSON when piped
ixora agents list -o json              # always JSON
ixora agents list --json               # same — shortcut
ixora agents list -o table             # force a table even when piped
ixora agents run sql "..." -o compact  # one-line summary; great for scripting
```

### Projecting fields with `--json`

`--json` accepts an optional comma list of field names. Only the listed fields are included in each row:

```bash
ixora agents list --json id,name
# [
#   { "id": "sql-agent", "name": "SQL Services" },
#   { "id": "sec-agent", "name": "Security Auditor" }
# ]

ixora traces list --json trace_id,status,duration
```

Field projection works on both **list** and **detail** commands. Note the shape difference: projected output is a flat array (list) or flat object (detail) with no `{data, meta}` envelope.

Without a field projection, list JSON rows contain the same fields as the table columns — not the raw API payload. For the full object, use the matching detail command (`ixora agents get <id> --json`) or project the fields you need explicitly (projection selects from the raw rows, so any API field is reachable).

---

## Examples by output style

### Table (default in a TTY)

```
$ ixora agents list
┌────────────┬─────────────────┬──────────────────────────────────┐
│ ID         │ NAME            │ DESCRIPTION                      │
├────────────┼─────────────────┼──────────────────────────────────┤
│ sql-agent  │ SQL Services    │ Db2 for i queries + monitoring   │
│ sec-agent  │ Security Auditor│ System security assessments      │
└────────────┴─────────────────┴──────────────────────────────────┘
Page 1 of 1 — 2 results
```

### JSON (piped or explicit)

```
$ ixora agents list | jq '.data[].id'
"sql-agent"
"sec-agent"
```

### Compact (for `agents run` / `agents continue`)

```
$ ixora agents run sql-agent "list largest tables" -o compact
sql-agent · run_abc123 · ✓ completed · 4s · 1,240 tokens
```

---

## Scripting patterns

### Pipe IDs into another command

```bash
ixora agents list --json id | jq -r '.[].id' \
  | while read id; do
      ixora agents get "$id" --json model
    done
```

### Filter trace failures, format with `column`

```bash
ixora traces list --json trace_id,status,duration | jq -r '
  .[] | select(.status != "ok")
  | "\(.trace_id)\t\(.status)\t\(.duration)"
' | column -t
```

### Capture a run's ID for follow-up calls

```bash
RUN_JSON=$(ixora agents run sql-agent "..." --json)
RUN_ID=$(echo "$RUN_JSON" | jq -r '.run_id')
ixora traces get "$RUN_ID"
```

---

## Streaming output (`--stream`)

`agents run`, `teams run`, and `workflows run` accept `--stream` to consume the Server-Sent Events (SSE) feed in real time. Streaming output is rendered incrementally regardless of `--output`; the final summary block honors the selected format.

```bash
ixora agents run sql-agent "long task" --stream
ixora agents run sql-agent "long task" --stream -o json   # JSON event objects
```

If the SSE stream drops, reconnect with:

```bash
ixora agents resume <agent_id> <run_id> [--last-event-index N] [--session-id S]
```

See [`runtime/agents.md`](runtime/agents.md) for details on streaming, pausing, and resuming.

---

## Pagination

List commands paginate locally with `--page` and `--limit` (defaults: page 1, limit 20). Meta is included in enveloped JSON output (bare `--json` / `-o json` / piped); a `--json <fields>` projection emits a flat array without meta:

```bash
ixora traces list --page 2 --limit 50
ixora traces list --json | jq '.meta'
# { "page": 1, "limit": 20, "total_pages": 7, "total_count": 134 }
```

---

## Disabling color

```bash
ixora agents list --no-color
NO_COLOR=1 ixora agents list
```

JSON output is never colorized.
