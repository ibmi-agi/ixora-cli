# `ixora memories`

Long-term memory store — distinct from session state. Memories survive across sessions and are typically scoped to a user.

```bash
ixora memories list
ixora memories get <memory_id>
ixora memories create --memory "..." [--topics a,b] [--user-id ...]
ixora memories update <memory_id> [--memory "..."] [--topics ...]
ixora memories delete <memory_id>
ixora memories delete-all --ids id1,id2
ixora memories topics
ixora memories stats
ixora memories optimize --user-id <id> [--apply]
```

All subcommands accept `--db-id <id>` to scope to a specific database.

---

## `list`

```bash
ixora memories list
ixora memories list --user-id alice
ixora memories list --search "indexing"
ixora memories list --topics "db2,performance"
ixora memories list --json memory_id,memory
```

| Flag | Purpose |
|---|---|
| `--user-id <id>` | Filter by user |
| `--team-id <id>` | Filter by team |
| `--agent-id <id>` | Filter by agent |
| `--search <text>` | Substring search within memory content |
| `--topics <csv>` | Filter by one or more topics |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |
| `--sort-by <field>` | Sort field |
| `--sort-order asc\|desc` | Sort direction |
| `--db-id <id>` | Database ID |

Output columns: `ID`, `MEMORY`, `TOPICS`, `USER_ID`.

---

## `get <memory_id>`

```bash
ixora memories get mem_abc
ixora memories get mem_abc --json
```

Default fields: `Memory ID`, `Memory`, `Topics`, `Agent ID`, `Team ID`, `User ID`, `Updated At`.

---

## `create`

```bash
ixora memories create --memory "Alice prefers SQL output as Markdown tables." --user-id alice --topics formatting,preferences
```

| Flag | Required | Purpose |
|---|---|---|
| `--memory <content>` | yes | Memory text |
| `--topics <csv>` | no | Comma-separated topics |
| `--user-id <id>` | no | Owner |
| `--db-id <id>` | no | Database ID |

Returns the new memory's ID, content, topics, and user ID.

---

## `update <memory_id>`

```bash
ixora memories update mem_abc --memory "Updated text"
ixora memories update mem_abc --topics formatting,preferences,sql
```

| Flag | Purpose |
|---|---|
| `--memory <content>` | New content |
| `--topics <csv>` | Replace topics |
| `--db-id <id>` | Database ID |

---

## `delete <memory_id>` and `delete-all`

```bash
ixora memories delete mem_abc

ixora memories delete-all --ids mem_a,mem_b,mem_c
ixora memories delete-all --ids mem_a,mem_b --user-id alice
```

`delete-all` options:

| Flag | Required | Purpose |
|---|---|---|
| `--ids <csv>` | yes | Comma-separated memory IDs |
| `--user-id <id>` | no | Scope to a user |
| `--db-id <id>` | no | Database ID |

---

## `topics`

List the set of topics across memories.

```bash
ixora memories topics
ixora memories topics --user-id alice
```

| Flag | Purpose |
|---|---|
| `--user-id <id>` | Filter by user |
| `--db-id <id>` | Database ID |

Output column: `TOPIC`.

---

## `stats`

Per-user memory counts.

```bash
ixora memories stats
ixora memories stats --user-id alice
```

| Flag | Purpose |
|---|---|
| `--user-id <id>` | Scope to a user |
| `--limit <n>` | Page size |
| `--page <n>` | Page number |
| `--db-id <id>` | Database ID |

Output columns: `USER_ID`, `TOTAL_MEMORIES`, `LAST_UPDATED`.

---

## `optimize`

Run the memory optimizer for a user — deduplicates, summarizes, and clusters memories.

```bash
ixora memories optimize --user-id alice                  # preview only
ixora memories optimize --user-id alice --apply          # apply changes
ixora memories optimize --user-id alice --model anthropic:claude-haiku-4-5
```

| Flag | Required | Purpose |
|---|---|---|
| `--user-id <id>` | yes | User to optimize |
| `--model <m>` | no | Provider:model string for the optimizer |
| `--apply` | no | Apply the optimization (default is preview / dry-run) |
| `--db-id <id>` | no | Database ID |

Returns a JSON diff with proposed changes. Re-run with `--apply` once you've reviewed.

---

## See also

- [`sessions.md`](sessions.md) — short-term conversation state
- [`knowledge.md`](knowledge.md) — long-form documents and search
