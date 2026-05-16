# Schedules — `ixora schedules`

> Canonical flag reference: [`../docs/runtime/schedules.md`](../docs/runtime/schedules.md). This page covers the path-vs-URL trap, the `trigger` vs cron-tick distinction, and the ID confusion between schedule-run IDs and agent run IDs.

Schedules are cron jobs the AgentOS server fires against its own HTTP endpoints (typically kicking off an agent / team / workflow run on a recurring cadence). Each fire is recorded as a **schedule run** with status, attempt count, and the resulting agent `run_id` / `session_id`.

Targets the resolved system. Use `--system <id>` to pick a specific one; `--url <url>` to skip resolution.

---

## Verbs

`list`, `get`, `create`, `update`, `delete`, `pause`, `resume`, `trigger`, `runs`, `get-run`.

| Verb | What it does |
|---|---|
| `list` | Paginated schedule list. `--enabled` filters to enabled only. |
| `get <id>` | Single schedule's full config (cron, endpoint, method, timezone, next run). |
| `create` | Define a new schedule. Server requires the `croniter` package — without it `create` returns 500 with an install hint. |
| `update <id>` | Patch one or more fields; only supplied flags are sent. |
| `delete <id>` | Permanent. No undo. |
| `pause <id>` | Disables — schedule stops firing but state is preserved. |
| `resume <id>` | Re-enables a paused schedule. |
| `trigger <id>` | Manually fire **now**, outside the cron cadence. Returns the new run record. |
| `runs <id>` | Paginated history of fires for one schedule. |
| `get-run <id> <run_id>` | Single run's status + linked agent `run_id` + `session_id` + error/output. |

---

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

`--payload` is a JSON string passed verbatim as the request body. Quote carefully — `'...'` (single quotes) keeps the JSON intact in bash/zsh. Invalid JSON errors client-side.

`--cron` accepts standard 5-field cron. `--timezone` defaults to `UTC` and accepts IANA names.

---

## trigger — fire now, ignore the cadence

```bash
ixora schedules trigger <schedule_id>
```

Returns the freshly created run record (`id`, `attempt`, `status`, plus the agent's own `run_id` once it's been issued). Use this to smoke-test a schedule's endpoint+payload without waiting for the cron tick.

The returned `run_id` field is the **agent/team run ID** — feed it to `ixora traces list --run-id ...` or use `ixora sessions runs <session_id>` to follow the work.

`trigger` does **not** bypass `enabled`. Even paused schedules accept manual triggers (they ignore the disabled flag), so a `trigger` on a paused schedule still runs.

---

## runs / get-run — inspect history

```bash
ixora schedules runs <schedule_id> --json id,attempt,status,triggered_at
ixora schedules get-run <schedule_id> <run_id>
```

Fields on a run:

| Field | Meaning |
|---|---|
| `id` | The schedule-run record's UUID (different from the agent `run_id`) |
| `attempt` | Increments on retry |
| `status` | Server-defined (`pending`, `success`, `failed`, etc.) |
| `status_code` | HTTP status of the dispatched call |
| `run_id` / `session_id` | Links back to the agent run the schedule kicked off |
| `triggered_at` / `completed_at` | Unix epoch seconds (not ISO) |
| `error` | Populated on failure |
| `output` | Response body of the dispatched call (truncated by output formatter) |

**ID confusion alert**: a schedule-run has its own `id`, and (once dispatched) a separate `run_id` belonging to the agent/team/workflow it triggered. They look similar but are not interchangeable.

---

## pause / resume vs delete

```bash
ixora schedules pause  <id>     # disabled = true, kept in DB
ixora schedules resume <id>     # disabled = false
ixora schedules delete <id>     # gone
```

Prefer `pause` when troubleshooting; `delete` only when the schedule is permanently retired.

---

## Recipes

```bash
# What's scheduled to fire today?
ixora schedules list --enabled --json id,name,cron,next_run_at

# Trigger a schedule and watch the resulting agent run
RUN_JSON=$(ixora schedules trigger <schedule_id> --json id,run_id,session_id)
AGENT_RUN=$(echo "$RUN_JSON" | jq -r '.run_id')
SESSION=$(echo "$RUN_JSON" | jq -r '.session_id')
ixora sessions runs "$SESSION"
ixora traces list --run-id "$AGENT_RUN"

# Build a schedule, dry-run it, then enable
SID=$(ixora schedules create --name "Test" --cron "0 3 * * *" \
      --endpoint /agents/sql-agent/runs --method POST \
      --payload '{"message":"hello"}' --json | jq -r '.id')
ixora schedules pause "$SID"           # don't fire on cron yet
ixora schedules trigger "$SID"         # run once now
ixora schedules runs "$SID"            # check it
ixora schedules resume "$SID"          # arm it

# Find recent failures across one schedule's history
ixora schedules runs <schedule_id> --json id,status,error \
  | jq '.data[] | select(.status != "success")'

# Bulk-pause every enabled schedule (rolling restart of cadence)
ixora schedules list --enabled --json id \
  | jq -r '.data[].id' \
  | xargs -n1 ixora schedules pause
```

---

## Gotchas

- **`--endpoint` is a path, not a URL.** Must start with `/`. The server validates and rejects full URLs.
- **`create` requires `croniter` on the server.** AgentOS installs it as part of the `agno[scheduler]` extra. A bare AgentOS without the extra returns `500 - 'croniter' not installed` on create.
- **`run_id` on a schedule-run is the agent's run ID**, not the schedule-run's own ID — that's `id`. Don't confuse the two when chaining into `traces` or `sessions`.
- **`update` is patch semantics.** Only the flags you pass are sent; omitted fields keep their current value. Empty string is **not** "clear" — there's no clear-field surface.
- **`trigger` does not bypass `enabled`.** Paused schedules still accept manual triggers — useful for smoke-testing without arming the cron.
- **`runs` and `get-run` time fields are unix epoch seconds**, not ISO. Convert with `jq 'todate'` or `date -r` for human reading.

---

## See also

- [`../docs/runtime/schedules.md`](../docs/runtime/schedules.md) — canonical command reference
- [`agents-teams-workflows.md`](agents-teams-workflows.md) — what the schedule's endpoint typically calls
- [`traces-sessions.md`](traces-sessions.md) — follow the trace via the schedule-run's `run_id` / `session_id`
- [`docs.md`](docs.md) — discover other schedulable endpoints via `ixora docs list --tag Schedules`
