# Schedules — `ixora schedules`

> **For exact flags, run `ixora schedules <verb> --help`.** This reference covers workflows and gotchas — it does not transcribe every flag.

Schedules are cron jobs the AgentOS server fires against its own HTTP endpoints (for example, kicking off an agent or team run on a recurring cadence). Each fire is recorded as a **schedule run** with its status, attempt count, and the resulting agent `run_id` / `session_id`.

Targets the resolved system. Use `--system <id>` to pick a specific one; `--url <url>` to skip resolution.

## Verbs

`list`, `get`, `create`, `update`, `delete`, `pause`, `resume`, `trigger`, `runs`, `get-run`.

| Verb | What it does |
|---|---|
| `list` | Paginated schedule list. `--enabled` filters to enabled only. |
| `get <id>` | Single schedule's full config (cron, endpoint, method, timezone, next run). |
| `create` | Define a new schedule. Server requires the `croniter` Python package — if missing, create returns 500 with an install hint. |
| `update <id>` | Patch one or more fields; only supplied flags are sent. |
| `delete <id>` | Permanent. No undo. |
| `pause <id>` | Disables — schedule stops firing but state is preserved. |
| `resume <id>` | Re-enables a paused schedule. |
| `trigger <id>` | Manually fire **now**, outside the cron cadence. Returns the new run record. |
| `runs <id>` | Paginated history of fires for one schedule. |
| `get-run <id> <run_id>` | Single run's status + linked agent `run_id` + `session_id` + error/output. |

## create — endpoint must be a path, not a URL

```bash
ixora schedules create \
  --name "nightly-health-check" \
  --cron "0 3 * * *" \
  --endpoint "/agents/ibmi-system-health/runs" \
  --method POST \
  --timezone America/New_York \
  --payload '{"message":"Full health check","stream":false}' \
  --timeout-seconds 600 \
  --max-retries 2 \
  --retry-delay-seconds 30
```

**Critical**: `--endpoint` is the **path** (e.g. `/agents/.../runs`), not a full URL. The server rejects values that don't start with `/`. The host is the AgentOS itself.

`--payload` is a JSON string passed verbatim as the request body. Quote carefully in shells.

`--cron` accepts standard 5-field cron. `--timezone` defaults to `UTC`.

## trigger — fire now, ignore the cadence

```bash
ixora schedules trigger <schedule_id>
```

Returns the freshly created run record (`id`, `attempt`, `status`, plus the agent's own `run_id` once it's been issued). Use this to smoke-test a schedule's endpoint+payload without waiting for the cron tick.

The returned `run_id` field is the **agent/team run ID** — feed it to `ixora traces list --filter '{"run_id":"..."}'` or use `ixora sessions runs <session_id>` to follow the work.

## runs / get-run — inspect history

```bash
ixora schedules runs <schedule_id> --json id,attempt,status,triggered_at
ixora schedules get-run <schedule_id> <run_id>
```

Fields on a run:
- `id` — the schedule-run record's UUID (different from the agent `run_id`)
- `attempt` — increments on retry
- `status` — server-defined (`pending`, `success`, `failed`, etc.)
- `status_code` — HTTP status of the dispatched call
- `run_id` / `session_id` — links back to the agent run the schedule kicked off
- `triggered_at` / `completed_at` — unix timestamps
- `error` — populated on failure
- `output` — response body of the dispatched call (truncated by output formatter)

## pause / resume vs delete

```bash
ixora schedules pause  <id>     # disabled = true, kept in DB
ixora schedules resume <id>     # disabled = false
ixora schedules delete <id>     # gone
```

Prefer `pause` when troubleshooting; delete only when the schedule is permanently retired.

## Recipes

```bash
# what's scheduled to fire today?
ixora schedules list --enabled --json id,name,cron,next_run_at

# trigger a schedule and watch the resulting agent run
RUN_JSON=$(ixora schedules trigger <schedule_id> --json id,run_id,session_id)
AGENT_RUN=$(echo "$RUN_JSON" | jq -r '.run_id')
SESSION=$(echo "$RUN_JSON" | jq -r '.session_id')
ixora sessions runs "$SESSION"
ixora traces list --json trace_id,run_id,status | jq --arg r "$AGENT_RUN" '.[] | select(.run_id==$r)'

# find recent failures across one schedule's history
ixora schedules runs <schedule_id> --json id,status,error \
  | jq '.[] | select(.status != "success")'

# bulk-pause every enabled schedule (rolling restart of cadence)
ixora schedules list --enabled --json id \
  | jq -r '.[].id' \
  | xargs -n1 ixora schedules pause
```

## Gotchas

- **`--endpoint` is a path, not a URL.** Must start with `/`. The server validates and rejects full URLs.
- **`create` requires `croniter` on the server.** AgentOS installs it as part of the `agno[scheduler]` extra. A bare AgentOS without the extra returns `500 - 'croniter' not installed` on create.
- **`run_id` on a schedule-run is the agent's run ID**, not the schedule-run's own ID — that's `id`. Don't confuse the two when chaining into `traces` or `sessions`.
- **`update` is patch semantics.** Only the flags you pass are sent; omitted fields keep their current value. Empty string is not "clear" — there's no clear-field surface today.
- **`trigger` does not bypass `enabled`.** Even paused schedules accept manual triggers (they ignore the disabled flag), so a `trigger` on a paused schedule still runs.
- **`runs` and `get-run` time fields are unix epoch seconds**, not ISO strings. Convert with `jq 'todate'` or `date -r` for human reading.
