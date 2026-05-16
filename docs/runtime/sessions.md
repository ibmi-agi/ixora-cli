# `ixora sessions`

Sessions hold the conversation state shared across runs (messages, summaries, custom state, metadata).

```bash
ixora sessions list
ixora sessions get <session_id>
ixora sessions create --type <t> --component-id <id> [--name ...] [--user-id ...]
ixora sessions update <session_id> [--name ...] [--state json] [--metadata json] [--summary ...]
ixora sessions delete <session_id>
ixora sessions delete-all --ids ... --types ...
ixora sessions runs <session_id>
```

All subcommands accept `--db-id <id>` to target a specific database (used in per-system DB isolation).

---

## `list`

```bash
ixora sessions list
ixora sessions list --type agent --component-id sql-agent
ixora sessions list --user-id alice --sort-by updated_at --sort-order desc
ixora sessions list --json session_id,session_name,type
```

| Flag | Default | Purpose |
|---|---|---|
| `--type <t>` | — | Filter by type: `agent`, `team`, `workflow` |
| `--component-id <id>` | — | Filter by the component the session belongs to |
| `--user-id <id>` | — | Filter by user ID |
| `--limit <n>` | `20` | Page size |
| `--page <n>` | `1` | Page number |
| `--sort-by <field>` | — | Sort field (e.g. `created_at`, `updated_at`) |
| `--sort-order asc\|desc` | — | Sort direction |
| `--db-id <id>` | — | Database ID |

Output columns: `SESSION_ID`, `NAME`, `TYPE`, `CREATED_AT`.

---

## `get <session_id>`

```bash
ixora sessions get sess_abc
ixora sessions get sess_abc --json
```

Default fields: `Session ID`, `Name`, `Type`, `State`, `Created At`, `Updated At`. The JSON form includes the full session payload (messages, summary, metadata).

| Flag | Purpose |
|---|---|
| `--db-id <id>` | Database ID |

---

## `create`

```bash
ixora sessions create --type agent --component-id sql-agent --name "Indexing review"
ixora sessions create --type team --component-id security-team --user-id alice
```

| Flag | Required | Purpose |
|---|---|---|
| `--type <t>` | yes | `agent`, `team`, or `workflow` |
| `--component-id <id>` | yes | The component owning the session |
| `--name <name>` | no | Human-readable name |
| `--user-id <id>` | no | Tag with a user |
| `--db-id <id>` | no | Database ID |

Returns the new session's ID, name, type, and creation timestamp. Use the ID with `agents run --session-id <id>` to keep conversation context across runs.

---

## `update <session_id>`

Mutate a session's name, state, metadata, or summary.

```bash
ixora sessions update sess_abc --name "Indexing review (closed)"
ixora sessions update sess_abc --state '{"step":3,"status":"in_progress"}'
ixora sessions update sess_abc --metadata '{"priority":"high"}'
ixora sessions update sess_abc --summary "Three findings; two acknowledged."
```

| Flag | Purpose |
|---|---|
| `--name <name>` | New display name |
| `--state <json>` | Session state as a JSON object |
| `--metadata <json>` | Arbitrary metadata |
| `--summary <text>` | Session summary text |
| `--db-id <id>` | Database ID |

JSON arguments are parsed client-side — invalid JSON errors out immediately.

---

## `delete <session_id>`

```bash
ixora sessions delete sess_abc
ixora sessions delete sess_abc --db-id ai_prod
```

---

## `delete-all`

Delete multiple sessions in one call. The lists must align positionally.

```bash
ixora sessions delete-all \
  --ids sess_a,sess_b,sess_c \
  --types agent,team,agent
```

| Flag | Required | Purpose |
|---|---|---|
| `--ids <csv>` | yes | Comma-separated session IDs |
| `--types <csv>` | yes | Comma-separated types (must match `--ids` 1:1) |
| `--user-id <id>` | no | Scope to a user |
| `--db-id <id>` | no | Database ID |

---

## `runs <session_id>`

List every run that belongs to a session.

```bash
ixora sessions runs sess_abc
ixora sessions runs sess_abc --json
```

Output columns: `RUN_ID`, `STATUS`, `CREATED_AT`.

| Flag | Purpose |
|---|---|
| `--db-id <id>` | Database ID |

---

## See also

- [`agents.md`](agents.md) / [`teams.md`](teams.md) / [`workflows.md`](workflows.md) — pass `--session-id` when running
- [`traces.md`](traces.md) — drill into per-run details from a session
- [`memories.md`](memories.md) — long-term memory separate from session state
