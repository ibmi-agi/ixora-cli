# `ixora agents`

Manage and execute agents on the targeted AgentOS.

```bash
ixora agents list
ixora agents get <agent_id>
ixora agents run <agent_id> "<message>"
ixora agents continue <agent_id> <run_id> [<tool_results>]
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
| `--session-id <id>` | Continue an existing session (preserves conversation state) |
| `--user-id <id>` | Tag the run with a user identifier |

### Output

- Without `--stream`: prints the final response. Uses the table/JSON/compact format selected via [`-o` / `--json`](../output-formats.md).
- With `--stream`: emits events as they arrive. The final summary respects `-o`.

### When the agent pauses for approval

Some tool calls require human approval. When the agent pauses, the run state is cached locally for 24h so you can confirm/reject with the next command.

```bash
$ ixora agents run sql-agent "drop temporary tables" --stream
... agent runs ...
⚠ Run paused — awaiting approval for tool: db.execute
  ixora agents continue sql-agent run_abc --confirm
  ixora agents continue sql-agent run_abc --reject "be more selective"
```

See `continue` below.

---

## `continue <agent_id> <run_id> [tool_results]`

Resume a paused or interrupted run. Three modes — pick exactly one:

```bash
# 1. Approve the cached paused tool call (most common)
ixora agents continue sql-agent run_abc --confirm

# 2. Reject the cached paused tool call (optional note)
ixora agents continue sql-agent run_abc --reject "use a soft delete instead"

# 3. Provide tool results JSON explicitly
ixora agents continue sql-agent run_abc '{"result":"ok"}'
```

| Flag | Effect |
|---|---|
| `--confirm` | Auto-build the confirm payload from the local paused-run cache. |
| `--reject [note]` | Auto-build a reject payload from the cache. The note (optional) becomes `confirmation_note`. |
| `--stream` | Stream the resumed response. |
| `--session-id <id>` | Override the session (defaults to the cached session ID). |
| `--user-id <id>` | Tag the run with a user identifier. |

### The local cache

Paused runs are written to `~/.ixora/paused-runs/<run_id>.json` (or platform equivalent), with a 24-hour TTL. `--confirm` / `--reject` read this cache. If the cache is missing:

```
$ ixora agents continue sql-agent run_abc --confirm
Error: No cached paused state for run run_abc.
       The cache may have expired (>24h) or this run was never paused.
```

In that case, pass tool results JSON explicitly as the third positional argument.

When `continue` resolves the pause without re-pausing, the cache entry is deleted. Re-paused runs keep their entry (the 24h TTL will clean it up).

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

### Approve any pending paused run

```bash
for f in ~/.ixora/paused-runs/*.json; do
  run_id=$(basename "$f" .json)
  agent_id=$(jq -r '.agent_id' < "$f")
  ixora agents continue "$agent_id" "$run_id" --confirm
done
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
