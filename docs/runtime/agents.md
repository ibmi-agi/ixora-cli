# `ixora agents`

Manage and execute agents on the targeted AgentOS.

```bash
ixora agents list
ixora agents get <agent_id>
ixora agents run <agent_id> "<message>" [--interactive]
ixora agents continue <run_id> [--confirm | --reject [note] | <tool_results>]
ixora agents continue <agent_id> <run_id> [<tool_results>]   # legacy 2-arg form
ixora agents pending [<run_id>]
ixora agents resume <agent_id> <run_id>
ixora agents cancel <agent_id> <run_id>
```

All subcommands accept the [global flags](../global-options.md) (`--system`, `--url`, `--json`, `-o`, …).

---

## `list`

List all registered agents.

```bash
ixora agents list
ixora agents list --limit 50 --page 2
ixora agents list --json id,name
```

| Flag | Default | Purpose |
|---|---|---|
| `--limit <n>` | `20` | Results per page |
| `--page <n>` | `1` | Page number |

Output columns: `ID`, `NAME`, `DESCRIPTION`.

---

## `get <agent_id>`

Fetch details for one agent.

```bash
ixora agents get sql-agent
ixora agents get sql-agent --json          # full payload
```

Default fields: `ID`, `Name`, `Description`, `Model`. The JSON form includes everything the API returns (tools list, model config, knowledge bindings, etc.).

---

## `run <agent_id> "<message>"`

Execute an agent against a message. The message is **one positional argument** — quote it.

```bash
ixora agents run sql-agent "list the 10 largest tables in QSYS2"
ixora agents run sql-agent "..." --stream
ixora agents run sql-agent "..." --session-id chat_abc --user-id alice
ixora agents run sql-agent "..." -o compact
```

| Flag | Effect |
|---|---|
| `--stream` | Stream the response via SSE (real-time tokens, tool calls, etc.) |
| `-i`, `--interactive` | When the run pauses, prompt **inline** for approve/reject instead of bouncing to a separate `agents continue` invocation. Requires `--stream` and a TTY. |
| `--session-id <id>` | Continue an existing session (preserves conversation state) |
| `--user-id <id>` | Tag the run with a user identifier |

### Output

- Without `--stream`: prints the final response. Uses the table/JSON/compact format selected via [`-o` / `--json`](../output-formats.md).
- With `--stream`: emits events as they arrive. The final summary respects `-o`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Run completed (or completed after interactive resume). |
| `2` | Stream emitted a `RunError` event. |
| `4` | Run paused awaiting tool confirmation. The cache at `~/.ixora/agentos-paused-runs/<run_id>.json` has the pending tool calls. Scripts can branch on this without parsing JSON. |

### When the agent pauses for approval

Some tool calls require human approval. When the agent pauses, the run state is cached locally for 24h and the CLI prints the next-step commands on stderr (so they don't pollute `-o json` / `-o compact` output on stdout):

```text
[Run Paused -- Tool requires confirmation]

  Tool:  validate_and_run_sql
  Args:  {"statement":"SELECT * FROM QSYS2.USER_INFO …"}
  ID:    toolu_01KL...

To confirm: ixora agents continue 5046ca44-... --confirm --stream
To reject:  ixora agents continue 5046ca44-... --reject  --stream
```

Two ways to drive the resume:

```bash
# A. Inline prompt (recommended for human use)
ixora agents run sql-agent "drop temp tables" --stream --interactive
# → on pause, the CLI shows a select prompt:
#   > Approve all
#     Reject all
#     Show details
#     Quit (cache preserved)
# Approving in-loop continues the same stream and re-prompts on every re-pause.

# B. Out-of-band (works after the fact, in scripts, after the original shell exited)
ixora agents pending                           # list paused runs
ixora agents continue <run_id> --confirm --stream
ixora agents continue <run_id> --reject "be more selective"
```

See `continue` and `pending` below.

---

## `continue [<agent_id>] <run_id> [tool_results]`

Resume a paused or interrupted run. Both positional shapes work:

```bash
# Cache form — agent_id read from the paused-run cache
ixora agents continue <run_id> --confirm
ixora agents continue <run_id> --reject "use a soft delete instead"

# Legacy 2-positional form — agent_id supplied explicitly
ixora agents continue <agent_id> <run_id> --confirm

# Raw tool_results JSON (no cache needed)
ixora agents continue <run_id> '{"tool_call_id":"…","output":"ok"}'
ixora agents continue <agent_id> <run_id> '{"tool_call_id":"…","output":"ok"}'
```

The CLI disambiguates by argument count and JSON-shape: if the second positional starts with `{`, `[`, or `"` it is treated as `tool_results`; otherwise it is treated as `<run_id>`.

| Flag | Effect |
|---|---|
| `--confirm` | Auto-build the confirm payload from the local paused-run cache. |
| `--reject [note]` | Auto-build a reject payload from the cache. The note (optional) becomes `confirmation_note`. |
| `--stream` | Stream the resumed response. |
| `-i`, `--interactive` | If the resumed run **re-pauses**, prompt inline for approve/reject again. Loops until the run completes or the user quits. |
| `--session-id <id>` | Override the session (defaults to the cached session ID). |
| `--user-id <id>` | Tag the run with a user identifier. |

### The local cache

Paused runs are written to `~/.ixora/agentos-paused-runs/<run_id>.json`, with a 24-hour TTL. `--confirm` / `--reject` read this cache. The cache record carries:

- `agent_id` — looked up when the cache form (single positional) is used.
- `session_id` — forwarded to AgentOS so consecutive `--confirm` calls don't 400 with `"session_id is required to continue a run"`. **The cache is merged on every re-pause** so a `RunStarted` event without `session_id` doesn't clobber the original.
- `prompt` — the message that started the run, surfaced by `agents pending` for re-run hints.

If the cache is missing:

```
$ ixora agents continue run_abc --confirm
Error: No cached paused state for run run_abc.
       The cache may have expired (>24h) or this run was never paused.
       Pass agent_id explicitly: ixora agents continue <agent_id> run_abc
```

In that case, pass tool results JSON explicitly with the legacy 2- or 3-positional form.

When `continue` resolves the pause without re-pausing, the cache entry is deleted. Re-paused runs keep their entry (the 24h TTL will clean it up).

---

## `pending [<run_id>]`

List or inspect runs that are paused awaiting tool confirmation. Reads the local paused-run cache — no network call.

```bash
# List all paused runs
ixora agents pending

  RUN ID                                 AGENT                            AGE   TOOLS  TOOL NAMES
  5046ca44-ffc0-4468-8d92-db215001cbfe   ibmi-security-agent--default     2m    2      validate_and_run_sql, validate_and_run_sql

  Approve: ixora agents continue <RUN ID> --confirm --stream
  Reject:  ixora agents continue <RUN ID> --reject  --stream

# Inspect one paused run (pretty-print pending tool calls + original prompt)
ixora agents pending 5046ca44-ffc0-4468-8d92-db215001cbfe

# Same, JSON form
ixora agents pending 5046ca44-ffc0-4468-8d92-db215001cbfe --json
```

The cache is local to your machine — `pending` only shows runs that *this* CLI saw pause. Stale entries (>24h) are pruned automatically before listing.

---

## `resume <agent_id> <run_id>`

Reconnect to an in-flight run's SSE stream after a dropped connection. The server replays any events you missed.

```bash
ixora agents resume sql-agent run_abc
ixora agents resume sql-agent run_abc --last-event-index 42
ixora agents resume sql-agent run_abc --session-id chat_session
```

| Flag | Effect |
|---|---|
| `--last-event-index <n>` | 0-based index of the last SSE event you received. Omit to replay from the start. |
| `--session-id <id>` | Required for the database fallback when the run is no longer in the in-memory buffer. |

The buffered window is bounded by the server — if the run is older than the buffer, `--session-id` lets the CLI fall back to replaying events from the database.

---

## `cancel <agent_id> <run_id>`

Cancel an in-progress run.

```bash
ixora agents cancel sql-agent run_abc
✓ Cancelled run run_abc for agent sql-agent
```

Cancellation is a request — the server stops emitting new events and marks the run cancelled. Tool calls already in-flight may still complete.

---

## Examples

### Capture a run ID for follow-up calls

```bash
RUN_ID=$(ixora agents run sql-agent "..." --json | jq -r '.run_id')
ixora traces get "$RUN_ID"
ixora sessions runs "$SESSION_ID"
```

### Approve every pending paused run

```bash
ixora agents pending --json \
  | jq -r '.data[].run_id' \
  | while read run_id; do
      ixora agents continue "$run_id" --confirm --stream
    done
```

### Branch a script on pause vs completion

```bash
ixora agents run sql-agent "audit job logs" --stream
case $? in
  0) echo "Run completed";;
  4) echo "Run paused — review with: ixora agents pending"; exit 0;;
  *) echo "Run failed"; exit 1;;
esac
```

### Cancel a runaway agent

```bash
ixora traces list --status running --json run_id \
  | jq -r '.data[].run_id' \
  | while read id; do
      ixora agents cancel sql-agent "$id"
    done
```

---

## See also

- [`teams.md`](teams.md), [`workflows.md`](workflows.md) — the same pattern for teams and workflows
- [`traces.md`](traces.md) — inspect a run after it completes
- [`sessions.md`](sessions.md) — manage the conversation context shared across runs
- [`approvals.md`](approvals.md) — the broader approval workflow (beyond inline pauses)
