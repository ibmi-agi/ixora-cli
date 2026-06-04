# `ixora agents`

Manage and execute agents on the targeted AgentOS.

```bash
ixora agents list
ixora agents get <agent_id>
ixora agents run <agent_id> "<message>" [--interactive | --bypass-confirmations]
ixora agents run <agent_id> "<message>" --background [--bypass-confirmations]
ixora agents runs [<run_id>] [--watch]
ixora agents continue <run_id> [--confirm | --reject [note] | <tool_results>]
ixora agents continue <agent_id> <run_id> [<tool_results>]   # legacy 2-arg form
ixora agents pending [<run_id>]
ixora agents resume <agent_id> <run_id>
ixora agents cancel <agent_id> <run_id>
ixora agents create [-f <file> | --name … --model …] [--dry-run]
ixora agents apply -f <file|dir> [-R] [--dry-run]
ixora agents update <agent_id> [-f <file> | --name … …] [--dry-run]
ixora agents delete <agent_id> [--dry-run]
ixora agents toolsets list
ixora agents toolsets get <name>
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
ixora agents run sql-agent "..." --background                    # fire-and-forget
ixora agents run sql-agent "..." --background --bypass-confirmations
```

| Flag | Effect |
|---|---|
| `--stream` | Stream the response via SSE (real-time tokens, tool calls, etc.) |
| `--background` | Dispatch the run server-side and return immediately with `{run_id, session_id, status}`. Fire-and-forget — poll it later with [`agents runs`](#runs-run_id). Requires a database on the agent. Mutually exclusive with `--stream`. |
| `--bypass-confirmations` | Auto-approve any tool call that requires confirmation, so the run never stalls. On a foreground run the CLI drives it to completion inline; on a `--background` run the intent is recorded and honored by `agents runs --watch`. Cannot be combined with `--interactive`. |
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

## `runs [<run_id>]`

List background runs, or poll/watch one. A background run is one started with
`agents run … --background`: it executes server-side and is tracked locally at
`~/.ixora/agentos-background-runs/<run_id>.json` (7-day TTL) so every follow-up
command takes just the `run_id`.

```bash
ixora agents runs                       # list this machine's background runs
ixora agents runs <run_id>              # poll one run's status + result
ixora agents runs <run_id> --watch      # poll until the run reaches a terminal status
```

| Flag | Effect |
|---|---|
| `--watch` | Poll every few seconds until the run finishes (or pauses). If the run was created with `--bypass-confirmations`, `--watch` auto-approves each pause and drives it to completion. |
| `--status <status>` | List mode only — filter by status. |
| `--interval <seconds>` | `--watch` poll interval (default `3`). |
| `--session-id <id>` | Session ID override (when the cached run has none). |

List output columns: `RUN ID`, `RESOURCE`, `STATUS`, `AGE`, `PROMPT`. The list
reads the local cache only — run a poll for fresh server status.

### Exit codes (poll / `--watch`)

| Code | Status | Meaning |
|---|---|---|
| `0` | `COMPLETED` / `RUNNING` / `PENDING` | Run is healthy — a plain poll of an in-progress run is not an error. |
| `2` | `ERROR` / `FAILED` | The run failed. |
| `1` | `CANCELLED` | The run was cancelled. |
| `4` | `PAUSED` | The run is awaiting tool confirmation. |

### Driving a paused background run

A fire-and-forget run that pauses for a tool confirmation cannot self-resume —
nothing is connected to it. `agents runs --watch` is the driver.

Whether `--watch` auto-approves depends on how the run was **started**:
`--bypass-confirmations` is a creation-time flag on `run`; `--watch` honors it
but cannot set it.

```bash
# Run created WITH --bypass-confirmations → --watch auto-approves every pause
ixora agents run <agent_id> "<task>" --background --bypass-confirmations
ixora agents runs <run_id> --watch

# Background the watcher with the shell — the CLI does not fork one for you
nohup ixora agents runs <run_id> --watch > <run_id>.log 2>&1 &
```

If the run was created **without** `--bypass-confirmations`, `--watch` stops at
the first pause (exit 4); a plain poll records the pending tools to the
paused-run cache so you can resolve them per-tool with
`agents continue <run_id> --confirm`.

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

### Run an agent in the background, then collect the result

```bash
ixora agents run sql-agent "audit DB2 table permissions" --background
# → { "run_id": "run-7f3a", "session_id": "sess-91", "status": "PENDING" }

ixora agents runs                       # list background runs
ixora agents runs run-7f3a              # poll one
ixora agents runs run-7f3a --watch      # block until terminal, then print the result
```

### Unattended background run (auto-approve tool confirmations)

```bash
# --bypass-confirmations is set once, at run creation
ixora agents run sql-agent "drop the temp_* tables" --background --bypass-confirmations
# → { "run_id": "run-c2d8", ... }

# Background the watcher with the shell; it auto-confirms every pause
# because the run was created with --bypass-confirmations:
nohup ixora agents runs run-c2d8 --watch > run-c2d8.log 2>&1 &
tail -f run-c2d8.log
```

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

## `create` / `apply` / `update` / `delete`

Manage an agent's **definition** (not its runs). Each verb takes a *friendly
manifest* — a YAML mapping (`-f <file>`, or `-f -` for stdin) or `--flag`
overrides — and POSTs to `/agents:apply`; `delete` calls `DELETE /agents/{id}`.

Manifest keys: `kind`, `id`, `name`, `description`, `model`, `db`, `stage`,
`instructions`, `toolsets`, `ibmiTools`, `options`, `metadata`. **Any other
top-level key is rejected** (not silently dropped):

```text
Error: Unknown field(s) in manifest: instructionz. Valid keys: kind, id, name, description, model, db, stage, instructions, toolsets, ibmiTools, options, metadata.
```

`--model` must be `provider:id` with both halves non-empty (e.g.
`anthropic:claude-sonnet-4-6`).

| Verb | Behavior |
|---|---|
| `create` | Fail (exit 1) if the agent already exists. Accepts a manifest, stdin (`-f -`), or flags-only. |
| `apply` | Upsert. Reports `created` / `updated` / `unchanged` (`unchanged` only when **both** the config bytes and the stage match). Pass a **directory** to apply every `*.agent.yaml` (`-R` recurses). |
| `update` | Sparse merge onto an existing agent; fail (exit 1) if absent. Requires at least one editable field. |
| `delete` | Hard-delete — frees the id and removes `user_tools/<id>/` on disk. Pre-checks existence (errors on a missing id). |

```bash
# Flags-only create
ixora agents create --name "QSYS Auditor" --id qsys-auditor \
  --model anthropic:claude-sonnet-4-6 --instructions "Audit job logs."

# Manifest file (or '-' for stdin)
ixora agents apply -f qsys-auditor.agent.yaml
cat qsys-auditor.agent.yaml | ixora agents create -f -

# Apply a whole directory (atomic — every manifest is validated before any POST)
ixora agents apply -f ./agents/ -R

# Sparse update — only the supplied fields change
ixora agents update qsys-auditor --model anthropic:claude-haiku-4-5
ixora agents update qsys-auditor --stage published

ixora agents delete qsys-auditor
```

The success line surfaces what the server did, including IBM i tools written and
any protected override keys it stripped (both on stderr, so `-o json` stdout
stays clean):

```text
Success: Created agent 'qsys-auditor' (stage=draft, version=1) (2 IBM i tool(s) written)
Warning: Ignored protected override key(s): tools, db
```

`--dry-run` emits the resolved spec as JSON without contacting the server. A
**directory** apply emits one combined document:

```json
{ "dry_run": true, "action": "agents.apply", "plans": [ { "action": "agents.apply", "target": "qsys-auditor", "payload": { } } ] }
```

### Attaching IBM i SQL tools — `--ibmi-tools <path>`

Repeatable. Each path is a SQL-tools-config YAML mapping (the same schema the
platform validates). Malformed YAML or a non-mapping is rejected client-side:

```text
Error: --ibmi-tools file ./tool.yaml must be a YAML mapping.
```

A mapping missing `source`/`description`, or carrying an unknown field, is
rejected by the server with a precise path (e.g. `tools.t: 'source' is a
required property`).

---

## `toolsets list` / `toolsets get <name>`

Browse the curated IBM i toolset catalog — the names you pass to `--toolsets`
(or the `toolsets:` manifest key) when creating an agent. **Both commands always
emit raw JSON**, regardless of `-o`/`--json`/TTY.

```bash
ixora agents toolsets list             # catalog of every toolset
ixora agents toolsets get performance  # one toolset's tools + parameters
```

`list` returns one object per toolset:

```json
[
  { "name": "daily_health", "title": "Daily Health", "description": "…", "tool_count": 7 }
]
```

`get <name>` returns the toolset's raw entry — its tools, per-tool descriptions,
and parameters:

```json
{
  "tools": ["system_status", "active_job_info"],
  "source": "performance.yaml",
  "tool_metadata": {
    "system_status": { "description": "First-call system health check…", "parameters": [] }
  }
}
```

An unknown name exits 1 with `Error: Toolset '<name>' not found. Run \`ixora
agents toolsets list\` …` on stderr.

---

## See also

- [`teams.md`](teams.md), [`workflows.md`](workflows.md) — the same pattern for teams and workflows
- [`traces.md`](traces.md) — inspect a run after it completes
- [`sessions.md`](sessions.md) — manage the conversation context shared across runs
- [`approvals.md`](approvals.md) — the broader approval workflow (beyond inline pauses)
