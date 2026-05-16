# Agents, Teams, Workflows — `ixora {agents,teams,workflows}`

> Canonical flag reference: [`../docs/runtime/agents.md`](../docs/runtime/agents.md), [`../docs/runtime/teams.md`](../docs/runtime/teams.md), [`../docs/runtime/workflows.md`](../docs/runtime/workflows.md). This page covers `continue`/`resume` shape differences, the HITL cache, and what `--confirm` actually does.

All three share the same verb set: `list`, `get`, `run`, `continue`, `resume`, `cancel`. Each targets the resolved system (see [system resolution in SKILL.md](../SKILL.md#system-resolution-the-part---help-wont-tell-you) or [`systems.md`](systems.md)).

`--system <id>` picks a specific system. `--url <url>` skips resolution (one-off probe against an unregistered endpoint).

---

## list

```bash
ixora {agents|teams|workflows} list                    # paginated; --limit / --page
ixora agents list --json id,name                       # JSON projection for scripting
ixora --system prod teams list
```

Output columns:

| Subcommand | Columns |
|---|---|
| `agents list` | `ID`, `NAME`, `DESCRIPTION` |
| `teams list` | `ID`, `NAME`, `MODE`, `DESCRIPTION` |
| `workflows list` | `ID`, `NAME`, `DESCRIPTION` |

Teams' `MODE` reflects coordination shape (`router`, `collaborator`, etc.). The JSON form returns the full payload for each row.

---

## get

```bash
ixora {agents|teams|workflows} get <id>
ixora agents get sql-agent --json                      # tools list, model config, KB bindings
```

For teams, `get` returns the member list — useful for routing diagnostics without invoking the team. For workflows, the JSON form includes per-step config.

---

## run

Single positional `<message>`; common options `--stream`, `--session-id <id>`, `--user-id <id>`.

```bash
# one-shot
ixora agents run sql-agent "list largest tables in QSYS2"

# stream live progress (SSE events: run.started, run.content, run.tool_call, run.tool_result, run.completed)
ixora teams run ibmi-team "Audit security on the prod LPAR" --stream

# continue a conversation by reusing the session ID
ixora agents run sql-agent "What are the top 5 by revenue?" --session-id chat_abc

# workflow run
ixora workflows run security-assessment "Audit production"

# target a specific system
ixora --system dev agents run sql-agent "Show me CUSTOMERS schema"

# compact one-liner for scripts
ixora agents run sql-agent "..." -o compact
# sql-agent · run_abc · ✓ completed · 4s · 1,240 tokens
```

Quote the message — it's a single positional string. Without `--stream` you get the final response as one payload (table/JSON/compact per `-o`). With `--stream` the CLI prints SSE events incrementally; the final summary still respects `-o`.

### Capture IDs for follow-up calls

```bash
RUN_JSON=$(ixora agents run sql-agent "..." --json)
RUN_ID=$(echo "$RUN_JSON" | jq -r '.run_id')
SESSION_ID=$(echo "$RUN_JSON" | jq -r '.session_id')
ixora traces get "$RUN_ID"
```

Or after the fact:

```bash
ixora traces list --limit 1 --json trace_id,run_id,session_id,input
```

---

## continue — verb shape differs by command

`continue` resumes a run that paused for human input (tool approval, clarifying question, workflow step). The argument list and convenience flags differ across the three:

```bash
# agents — agent_id is OPTIONAL when the cache has the run (preferred form)
ixora agents continue <run_id>                                              # interactive (raw)
ixora agents continue <run_id> --confirm                                    # approve & resume
ixora agents continue <run_id> --reject "use a soft delete instead"
ixora agents continue <run_id> '{"tool_call_id":"...","output":"..."}'      # raw payload

# Legacy 2-positional form still works:
ixora agents continue <agent_id> <run_id> --confirm

# teams + workflows: required <message>, no --confirm/--reject
ixora teams     continue <team_id>     <run_id> "<message>" [--stream]
ixora workflows continue <workflow_id> <run_id> "<message>"
```

`--confirm` / `--reject` are agent-only. They reconstruct the paused tool-call payload from a local cache so you don't have to hand-build `tool_results` JSON. The agent_id is read from that same cache when the single-positional form is used.

The non-stream `continue` result honors `--json fields` projection — `ixora agents continue <run> --confirm --json run_id,session_id` returns just those fields.

### Interactive resume — `--interactive` / `-i`

Skip the bounce to a second invocation. With `--stream --interactive` (and a TTY), pauses prompt inline:

```bash
ixora agents run <agent_id> "<message>" --stream --interactive
# on RunPaused:
#   > Approve all
#     Reject all
#     Show details
#     Quit (cache preserved)
# Loops on every re-pause; resolves the same SSE stream.
```

Same flag works on `agents continue` for the case where you started raw and want the loop to take over after the first manual approval.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Run completed (or completed after interactive resume). |
| `2` | Stream emitted a `RunError`. |
| `4` | Run paused awaiting tool confirmation. Branch on `$?` instead of grepping the log. |

### Discovering paused runs — `agents pending`

```bash
ixora agents pending                # table of cached paused runs
ixora agents pending <run_id>       # pretty-print pending tools + original prompt
ixora agents pending <run_id> --json
```

Use this when you start a run, walk away, and come back not remembering which run paused.

### The local paused-run cache

The cache `--confirm` / `--reject` read from is written **only when the original `agents run` (or a prior `continue`) observed a paused event with tools**. It lives at:

```
~/.ixora/agentos-paused-runs/<run_id>.json
```

The cache record stores `agent_id`, `session_id`, `tools[]`, and the original `prompt`. **It's merged on every re-pause** so consecutive `--confirm`s preserve `session_id` even when AgentOS's `RunStarted` on the second pause omits it (this used to surface as `session_id is required to continue a run`).

**TTL: 24 hours.** Cache entries also evaporate if the run is resolved without re-pausing. If the cache is missing or stale:

```
Error: No cached paused state for run <run_id>.
       The cache may have expired (>24h) or this run was never paused.
       Pass agent_id explicitly: ixora agents continue <agent_id> <run_id>
```

Recovery options:

```bash
# 1. Pass raw tool_results JSON as the positional arg
ixora agents continue <agent_id> <run_id> '{"tool_call_id":"...","output":"..."}'

# 2. Re-run the agent to repopulate the cache, then --confirm/--reject
ixora agents run <agent_id> "<same prompt>" --stream
ixora agents continue <new_run_id> --confirm
```

The cache survives shell sessions but is **local to this machine** — a teammate's CLI can't `--confirm` a run you observed.

For approvals emitted out-of-band by workflows (not inline tool pauses), use [`ixora approvals`](observability.md#ixora-approvals--out-of-band-approval-workflow) instead.

---

## resume — reconnect to a streaming run

`resume` is for **stream reconnection after disconnection**, not for paused HITL runs. If your `--stream` connection dropped (Ctrl-C, network blip, terminal closed) you can pick the SSE stream back up.

```bash
ixora {agents|teams|workflows} resume <component_id> <run_id> \
  [--last-event-index <n>] [--session-id <id>]
```

**Don't confuse `continue` with `resume`:**

| Verb | When | What it does |
|---|---|---|
| `continue` | Run is **paused** (HITL — tool approval / message / user input) | Submits the resolution and unpauses. |
| `resume`   | Run is **streaming** or **completed**, you just lost the connection | Replays missed SSE events (and keeps streaming if active). |

### Three replay paths

The server resolves which automatically:

1. **Run still active** — sends catch-up events since `last_event_index`, then continues live streaming.
2. **Run completed (in buffer)** — replays missed events from the in-memory buffer.
3. **Run completed (in database)** — replays events from the DB. **Requires `--session-id`** so the server can find them.

### `--last-event-index`

Each SSE event carries a 0-based `event_index`. To resume from where you left off, pass the **last** index you received. The server returns events with `event_index > N`. Omit to replay from 0.

```bash
# I got up to event_index 100 before disconnect — give me 101 onwards
ixora agents resume sql-agent <run_id> --last-event-index 100 --session-id <session_id>

# I lost everything — replay the whole run
ixora agents resume sql-agent <run_id> --session-id <session_id>
```

### Replay sentinel

Replays open with a synthetic `{"event": "replay", ...}` event before the historical stream. Treat it as a marker that what follows is replayed (not live). `handleStreamRun` ignores it for content rendering, so it only matters under `-o json`.

### Gotcha: active runs may not be buffered yet

If you resume *immediately* after starting a run, the server can answer with `"Run <id> not found in buffer or database"`. The buffer is populated as the run proceeds and the DB after completion — a few-second-old active run, or any completed run with `--session-id`, works reliably. Pure ephemeral runs that finish faster than buffer-flush won't be replayable.

---

## cancel

```bash
ixora {agents|teams|workflows} cancel <component_id> <run_id>
```

Terminates an in-progress run. Useful when a loop is stuck or a streaming call was abandoned. Tool calls already in-flight may still complete server-side.

```bash
# Cancel every running agent
ixora traces list --status running --json run_id agent_id \
  | jq -r '.data[] | "\(.agent_id) \(.run_id)"' \
  | while read agent run; do
      ixora agents cancel "$agent" "$run"
    done
```

---

## Recipes

### Run an agent, capture IDs, watch its trace

```bash
RUN_JSON=$(ixora agents run sql-agent "audit job logs" --json)
RUN_ID=$(echo "$RUN_JSON" | jq -r '.run_id')
ixora traces get "$RUN_ID"
```

### Approve a paused tool call

```bash
# Inline (single terminal session, recommended for human use):
ixora agents run sql-agent "drop temp tables" --stream --interactive

# Out-of-band (the "I closed the terminal" recovery):
ixora agents pending                          # find the run
ixora agents continue <run_id> --confirm      # approve (agent_id pulled from cache)
ixora agents continue <run_id> --reject "use soft delete instead"   # or reject
```

### Continue a team conversation

```bash
ixora teams run security-team "audit prod" --session-id audit_2026_05
# ... follow-up later
ixora teams continue security-team <run_id> "expand on finding #3"
```

### Reconnect a dropped stream

```bash
ixora agents resume sql-agent <run_id> --last-event-index 42 --session-id <session>
```

---

## Tips

- After a `run`, find the freshly-minted IDs with `ixora traces list --limit 1 --json trace_id,run_id,session_id,input` — useful for chaining into `traces get` or `sessions runs`.
- For team routing diagnostics (who did the leader hand off to?), filter `traces list --agent-id <member_id>` for that member's traces. `traces list` has no `--team-id` filter — for per-trace team listing use `traces search --filter '{"team_id":"<id>"}'`. See [`traces-sessions.md`](traces-sessions.md).
- The CLI has no `--response-model` for structured output. Hit the HTTP API directly (see [`docs.md`](docs.md)) or use `@worksofadam/agentos-sdk`.

---

## See also

- [`../docs/runtime/agents.md`](../docs/runtime/agents.md), [`../docs/runtime/teams.md`](../docs/runtime/teams.md), [`../docs/runtime/workflows.md`](../docs/runtime/workflows.md) — canonical command reference
- [`traces-sessions.md`](traces-sessions.md) — inspect a run after it ran
- [`schedules.md`](schedules.md) — fire a `run` on cron
- [`observability.md`](observability.md) — `ixora approvals` for out-of-band approval objects
