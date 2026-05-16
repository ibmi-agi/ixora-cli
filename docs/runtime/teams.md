# `ixora teams`

Manage and execute teams — coordinated groups of agents.

```bash
ixora teams list
ixora teams get <team_id>
ixora teams run <team_id> "<message>"
ixora teams continue <team_id> <run_id> "<message>"
ixora teams resume <team_id> <run_id>
ixora teams cancel <team_id> <run_id>
```

The mechanics mirror [`agents`](agents.md). This page calls out only the team-specific differences.

---

## `list`

```bash
ixora teams list
ixora teams list --json id,name,mode
```

| Flag | Default | Purpose |
|---|---|---|
| `--limit <n>` | `20` | Results per page |
| `--page <n>` | `1` | Page number |

Output columns: `ID`, `NAME`, `MODE`, `DESCRIPTION`. `MODE` reflects how the team coordinates (e.g. router, collaborator).

---

## `get <team_id>`

```bash
ixora teams get security-team
ixora teams get security-team --json
```

Default fields: `ID`, `Name`, `Mode`, `Description`, `Model`.

---

## `run <team_id> "<message>"`

```bash
ixora teams run security-team "audit job log volumes on QSYS"
ixora teams run security-team "..." --stream
ixora teams run security-team "..." --session-id chat_abc --user-id alice
```

| Flag | Effect |
|---|---|
| `--stream` | Stream the response via SSE |
| `--session-id <id>` | Continue an existing session |
| `--user-id <id>` | Tag the run with a user identifier |

---

## `continue <team_id> <run_id> "<message>"`

Continue a team run with a follow-up message. Unlike `agents continue`, teams take a **message** (not tool results / `--confirm` / `--reject`).

```bash
ixora teams continue security-team run_abc "expand on finding #3"
ixora teams continue security-team run_abc "..." --stream
```

| Flag | Effect |
|---|---|
| `--stream` | Stream the response. |
| `--session-id <id>` | Override the session. |
| `--user-id <id>` | Tag with a user. |

---

## `resume <team_id> <run_id>`

Reconnect to a dropped SSE stream.

```bash
ixora teams resume security-team run_abc
ixora teams resume security-team run_abc --last-event-index 12
ixora teams resume security-team run_abc --session-id chat_session
```

Same flags as [`agents resume`](agents.md#resume-agent_id-run_id).

---

## `cancel <team_id> <run_id>`

```bash
ixora teams cancel security-team run_abc
```

---

## See also

- [`agents.md`](agents.md) — single-agent execution and approval flow
- [`workflows.md`](workflows.md) — deterministic step-based execution
- [`traces.md`](traces.md), [`sessions.md`](sessions.md)
