# Runtime Commands

Talk directly to the AgentOS server running on the targeted system. Every command in this section is a top-level group on the `ixora` binary (no `stack` prefix).

```bash
ixora agents list
ixora traces get <id>
ixora knowledge search "..."
ixora schedules trigger <id>
```

---

## Targeting a system

Every runtime command picks one AgentOS endpoint to talk to. Resolution order:

1. `--url <url>` → use it directly (skip all system lookup).
2. `--system <id>` → resolve that system from `~/.ixora/ixora-systems.yaml`.
3. Configured default (`ixora stack system default <id>`) — if it's in the available set.
4. Exactly one available system → use it.
5. Otherwise → error asking for `--system`.

Externals always count as "available" (no container check).

```bash
ixora agents list                              # implicit — uses the only available, or the default
ixora --system prod agents list                # one-off override
ixora stack system default prod                # persistent default
ixora --url http://localhost:18099 agents list # ad-hoc endpoint
ixora --key sk-xxx --url http://… agents list  # ad-hoc endpoint with key
```

See [`../global-options.md`](../global-options.md) and [`../stack/systems.md`](../stack/systems.md) for the rules in full.

---

## Pages

### Agent execution

- [`agents`](agents.md) — list, get, run, continue (with `--confirm`/`--reject`), resume SSE, cancel
- [`teams`](teams.md) — list, get, run, continue, resume, cancel
- [`workflows`](workflows.md) — list, get, run, continue, resume, cancel

### Observability

- [`status`](status.md) — overall AgentOS resources (databases, agents, knowledge, interfaces)
- [`health`](health.md) — ping `/health`, report uptime + latency (exits non-zero when unhealthy)
- [`traces`](traces.md) — list, get, stats, search
- [`metrics`](metrics.md) — get aggregated metrics, refresh

### State & data

- [`sessions`](sessions.md) — list, get, create, update, delete, runs
- [`memories`](memories.md) — list, get, create, update, delete, topics, stats, optimize
- [`knowledge`](knowledge.md) — upload, list, get, search, status, delete, config

### Governance

- [`approvals`](approvals.md) — list, get, resolve (approve/reject)
- [`evals`](evals.md) — list, get, run, delete

### Scheduling

- [`schedules`](schedules.md) — list, get, create, update, pause, resume, runs, get-run, trigger

### Infrastructure

- [`components`](components.md) — list, get, create, update, delete, config (agents/teams/workflows as data)
- [`models`](models.md) — list available models in AgentOS
- [`databases`](databases.md) — migrate
- [`registries`](registries.md) — list registry items
- [`docs`](docs.md) — inspect the raw HTTP API via `/openapi.json`

---

## Common conventions

All list commands accept:

| Flag | Default | Purpose |
|---|---|---|
| `--limit <n>` | `20` | Page size |
| `--page <n>` | `1` | Page number |
| `--sort-by <field>` | — | Sort field (where supported) |
| `--sort-order asc\|desc` | — | Sort direction |

All commands respect the [output flags](../output-formats.md) `--json [fields]` and `-o table|json|compact`. Examples assume a TTY (table output) — pipe to anything else and the CLI auto-switches to JSON.

`run` / `continue` commands support:

| Flag | Effect |
|---|---|
| `--stream` | Stream the response as SSE events |
| `--session-id <id>` | Use a specific session for conversation context |
| `--user-id <id>` | Tag the run with a user ID |

If an SSE stream drops, reconnect with the corresponding `resume` subcommand on `agents` / `teams` / `workflows`.

---

## Worked examples

### Run an agent and follow its trace

```bash
RUN_JSON=$(ixora agents run sql-agent "list largest tables" --json)
RUN_ID=$(echo "$RUN_JSON" | jq -r '.run_id')
ixora traces get "$RUN_ID"
```

### Approve a paused tool call

```bash
ixora agents run sql-agent "drop temp table" --stream
# ... agent pauses on a destructive tool call
ixora agents continue sql-agent <run_id> --confirm
# Or reject with a note:
ixora agents continue sql-agent <run_id> --reject "use a soft delete instead"
```

### Search knowledge with hybrid search

```bash
ixora knowledge search "DB2 indexing" --search-type hybrid --max-results 10
```

### Daily metrics for the last week

```bash
ixora metrics get --start-date 2026-05-08 --end-date 2026-05-15
```
