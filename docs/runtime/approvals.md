# `ixora approvals`

Out-of-band approval workflow. Use this when an agent has flagged an action that needs human sign-off — distinct from the inline `agents continue --confirm` pause flow, which auto-caches the paused run.

```bash
ixora approvals list
ixora approvals get <id>
ixora approvals resolve <id> --status approved|rejected [--resolved-by ...] [--resolution-data <json>]
```

---

## `list`

```bash
ixora approvals list
ixora approvals list --status pending
ixora approvals list --agent-id sql-agent --json id,status,type
```

| Flag | Purpose |
|---|---|
| `--status <s>` | Filter by status (e.g. `pending`, `approved`, `rejected`) |
| `--agent-id <id>` | Filter by agent ID |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |

Output columns: `ID`, `STATUS`, `TYPE`, `CREATED_AT`.

---

## `get <id>`

```bash
ixora approvals get apr_abc
ixora approvals get apr_abc --json
```

Default fields: `ID`, `Status`, `Type`, `Agent ID`, `Details` (stringified JSON), `Created`.

---

## `resolve <id>`

Mark an approval resolved.

```bash
ixora approvals resolve apr_abc --status approved --resolved-by alice
ixora approvals resolve apr_abc --status rejected --resolved-by alice \
  --resolution-data '{"reason":"insufficient justification"}'
```

| Flag | Required | Purpose |
|---|---|---|
| `--status <s>` | yes | Resolution status — typically `approved` or `rejected` |
| `--resolved-by <user>` | no | Who resolved it (audit trail) |
| `--resolution-data <json>` | no | Free-form JSON attached to the resolution |

Returns: `ID`, `Status`, `Resolved By`, `Resolved At`.

Invalid JSON for `--resolution-data` errors client-side.

---

## How this fits with `agents continue --confirm`

Two related approval surfaces:

| Surface | Used when | How to resolve |
|---|---|---|
| `agents continue` inline pause | An agent run paused mid-execution on a tool call | `ixora agents continue <agent_id> <run_id> --confirm \| --reject [note]` |
| `approvals list/get/resolve` | The server emitted a generic approval object (could be triggered by any component) | `ixora approvals resolve <id> --status approved` |

If you're not sure which mechanism a given pause uses, check `traces get <run_id>` — it includes the approval ID (if any) in the trace metadata.

---

## See also

- [`agents.md#continue-agent_id-run_id-tool_results`](agents.md#continue-agent_id-run_id-tool_results) — inline approval flow
- [`traces.md`](traces.md) — find the approval that gated a run
