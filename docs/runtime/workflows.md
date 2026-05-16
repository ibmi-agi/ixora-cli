# `ixora workflows`

Manage and execute workflows — multi-step pipelines that may include deterministic steps as well as agent calls.

```bash
ixora workflows list
ixora workflows get <workflow_id>
ixora workflows run <workflow_id> "<message>"
ixora workflows continue <workflow_id> <run_id> "<message>"
ixora workflows resume <workflow_id> <run_id>
ixora workflows cancel <workflow_id> <run_id>
```

The pattern mirrors [`agents`](agents.md) and [`teams`](teams.md); only workflow-specific details are covered here.

---

## `list`

```bash
ixora workflows list
ixora workflows list --json id,name
```

Output columns: `ID`, `NAME`, `DESCRIPTION`.

| Flag | Default | Purpose |
|---|---|---|
| `--limit <n>` | `20` | Page size |
| `--page <n>` | `1` | Page number |

---

## `get <workflow_id>`

```bash
ixora workflows get security-assessment
ixora workflows get security-assessment --json
```

Default fields: `ID`, `Name`, `Description`, `Steps` (count), `Workflow Agent` (`Yes` if the workflow uses an orchestration agent).

---

## `run <workflow_id> "<message>"`

```bash
ixora workflows run security-assessment "audit production"
ixora workflows run security-assessment "..." --stream
ixora workflows run security-assessment "..." --session-id audit_2026_05
```

| Flag | Effect |
|---|---|
| `--stream` | Stream the response via SSE. |
| `--session-id <id>` | Continue an existing session. |
| `--user-id <id>` | Tag with a user identifier. |

Workflows often emit a structured per-step result. With `--stream`, each step's progress arrives as it happens.

---

## `continue <workflow_id> <run_id> "<message>"`

Resume a paused / waiting workflow with a follow-up message.

```bash
ixora workflows continue security-assessment run_abc "proceed to step 3"
ixora workflows continue security-assessment run_abc "..." --stream
```

| Flag | Effect |
|---|---|
| `--stream` | Stream the response. |
| `--session-id <id>` | Override the session. |
| `--user-id <id>` | Tag with a user. |

---

## `resume <workflow_id> <run_id>`

Reconnect a dropped SSE stream.

```bash
ixora workflows resume security-assessment run_abc --last-event-index 8
```

Flags: `--last-event-index <n>`, `--session-id <id>` — see [`agents resume`](agents.md#resume-agent_id-run_id).

---

## `cancel <workflow_id> <run_id>`

```bash
ixora workflows cancel security-assessment run_abc
```

---

## See also

- [`agents.md`](agents.md), [`teams.md`](teams.md)
- [`schedules.md`](schedules.md) — run a workflow on cron
- [`traces.md`](traces.md) — per-step trace inspection
