# `ixora schedules`

Cron-based scheduled HTTP calls — typically used to trigger agent / team / workflow runs on a recurring basis.

```bash
ixora schedules list
ixora schedules get <id>
ixora schedules create --name ... --cron "..." --endpoint ... --method POST [options]
ixora schedules update <id> [options]
ixora schedules delete <id>
ixora schedules pause <id>
ixora schedules resume <id>
ixora schedules runs <id>
ixora schedules get-run <id> <run_id>
ixora schedules trigger <id>
```

---

## `list`

```bash
ixora schedules list
ixora schedules list --enabled
ixora schedules list --json id,name,cron,enabled
```

| Flag | Purpose |
|---|---|
| `--enabled` | Filter to enabled schedules only |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |

Output columns: `ID`, `NAME`, `CRON`, `ENABLED`, `NEXT_RUN_AT`.

---

## `get <id>`

```bash
ixora schedules get sch_abc
ixora schedules get sch_abc --json
```

Default fields: `ID`, `Name`, `Cron`, `Endpoint`, `Method`, `Enabled`, `Timezone`, `Next Run At`, `Created`.

---

## `create`

Create a new schedule that POSTs to an AgentOS endpoint on a cron expression.

```bash
ixora schedules create \
  --name "Hourly tables audit" \
  --cron "0 * * * *" \
  --endpoint /agents/sql-agent/run \
  --method POST \
  --payload '{"message":"list largest tables"}'

ixora schedules create \
  --name "Nightly security audit" \
  --cron "0 2 * * *" \
  --timezone America/Chicago \
  --endpoint /workflows/security-assessment/run \
  --method POST \
  --payload '{"message":"audit production"}' \
  --max-retries 3 --retry-delay-seconds 60 --timeout-seconds 600
```

### Required flags

| Flag | Notes |
|---|---|
| `--name <name>` | Display name |
| `--cron <expr>` | Standard cron expression (5 fields: minute hour day month weekday) |
| `--endpoint <url>` | URL or path the schedule will hit |
| `--method <m>` | HTTP method: `GET`, `POST`, etc. |

### Optional flags

| Flag | Default | Purpose |
|---|---|---|
| `--description <desc>` | — | Free-form description |
| `--payload <json>` | — | Request body |
| `--timezone <tz>` | `UTC` | IANA timezone |
| `--timeout-seconds <n>` | — | Per-run timeout |
| `--max-retries <n>` | — | Retry count on failure |
| `--retry-delay-seconds <n>` | — | Delay between retries |

Invalid JSON for `--payload` errors client-side.

---

## `update <id>`

Same flags as `create`, all optional. Only supplied flags are mutated.

```bash
ixora schedules update sch_abc --cron "*/15 * * * *"
ixora schedules update sch_abc --payload '{"message":"new prompt"}' --timezone UTC
```

---

## `delete <id>`

```bash
ixora schedules delete sch_abc
```

---

## `pause <id>` / `resume <id>`

Disable or re-enable a schedule without deleting it.

```bash
ixora schedules pause sch_abc
ixora schedules resume sch_abc
```

---

## `runs <id>`

List the run history for a schedule.

```bash
ixora schedules runs sch_abc
ixora schedules runs sch_abc --json
```

Output columns: `ID`, `ATTEMPT`, `STATUS`, `RUN_ID`, `TRIGGERED_AT`, `COMPLETED_AT`.

---

## `get-run <id> <run_id>`

Inspect a single schedule run.

```bash
ixora schedules get-run sch_abc run_xyz
ixora schedules get-run sch_abc run_xyz --json
```

Default fields: `ID`, `Schedule ID`, `Attempt`, `Status`, `Status Code`, `Run ID`, `Session ID`, `Triggered At`, `Completed At`, `Error`.

---

## `trigger <id>`

Run a schedule **right now**, regardless of its cron expression.

```bash
ixora schedules trigger sch_abc
```

Returns the new run's `id`, `schedule_id`, `attempt`, `status`, agent run `run_id`, and `triggered_at`. Useful for smoke-testing a schedule definition before waiting for the next cron tick.

---

## Common flows

### Build a schedule, dry-run it, then enable

```bash
SID=$(ixora schedules create \
  --name "Test" --cron "0 3 * * *" \
  --endpoint /agents/sql-agent/run --method POST \
  --payload '{"message":"hello"}' --json | jq -r '.id')

ixora schedules pause "$SID"               # don't fire on cron yet
ixora schedules trigger "$SID"             # run once now
ixora schedules runs "$SID"                # check it
ixora schedules resume "$SID"              # arm it
```

### Find failing schedules from the last day

```bash
ixora schedules list --enabled --json id \
  | jq -r '.data[].id' \
  | while read id; do
      ixora schedules runs "$id" --json \
        | jq --arg id "$id" -r '.data[] | select(.status != "ok") | "\($id) \(.id) \(.status)"'
    done
```

---

## See also

- [`agents.md`](agents.md) / [`workflows.md`](workflows.md) — the endpoints schedules typically call
- [`traces.md`](traces.md) — drill into the trace via the schedule run's `run_id`
