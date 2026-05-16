# Memories — `ixora memories`

> Canonical flag reference: [`../docs/runtime/memories.md`](../docs/runtime/memories.md). This page covers the batch-delete shape, optimizer dry-run flow, and `--db-id` semantics.

**Memories** = long-lived facts the system stores about a user (preferences, learned patterns). Scoped to a `user_id`, optionally narrowed by `agent_id` or `team_id`. For ingested documents and search, see [`knowledge.md`](knowledge.md).

Verbs: `list`, `get`, `create`, `update`, `delete`, `delete-all`, `topics`, `stats`, `optimize`. Each targets the resolved system (`--system` / `--url` apply). All accept `--db-id <id>` to scope to a specific database under per-system isolation.

---

## CRUD

```bash
ixora memories list   --user-id <id> [--agent-id <id>] [--team-id <id>] [--search <text>] [--topics csv]
ixora memories get    <memory_id>
ixora memories create --memory "User prefers concise answers" --user-id alice --topics "preferences,style"
ixora memories update <memory_id> --memory "..." --topics "..."
ixora memories delete <memory_id>
```

CRUD verbs are `create` / `update` / `delete` (not `add` / `edit` / `remove`).

`update` replaces fields wholesale — you can't append a topic, you replace the topics list. Same for memory text.

---

## `delete-all` is batch-by-ID, NOT filter-based

```bash
ixora memories delete-all --ids id1,id2,id3 [--user-id <id>]
```

`--ids` is **required**. `--user-id` narrows the delete to that user's memories within those IDs — it does **not** enable a "delete everything for this user" shortcut.

To purge by filter, list → extract IDs → call `delete-all`:

```bash
ids=$(ixora memories list --user-id alice --limit 200 --json memory_id \
      | jq -r 'map(.memory_id) | join(",")')
ixora memories delete-all --ids "$ids" --user-id alice
```

If the user has more than 200 memories, paginate (`--page 2`, `--page 3`, …) and concatenate.

---

## `topics`, `stats`, `optimize`

```bash
ixora memories topics  --user-id <id>                # distinct topics for a user
ixora memories stats   --user-id <id>                # counts / last-updated
ixora memories optimize --user-id <id>               # dry-run: preview a dedup/merge plan
ixora memories optimize --user-id <id> --apply       # apply the plan
ixora memories optimize --user-id <id> --model anthropic:claude-haiku-4-5
```

`optimize` runs an agentic dedup/merge over a user's memories. **Default is dry-run** — it returns a JSON diff of proposed changes. Re-run with `--apply` once you've reviewed.

Use `--model` to override the optimizer's model (e.g. a smaller/cheaper one for bulk runs).

---

## Recipes

### What does the system "remember" about this user + agent combo?

```bash
ixora memories list --user-id alice --agent-id sql-agent --limit 50
```

### Search memories for a keyword

```bash
ixora memories list --user-id alice --search "QSECURITY"
```

### Topic breakdown for a user

```bash
ixora memories topics --user-id alice
ixora memories stats  --user-id alice
```

### Dry-run optimize, eyeball the diff, then apply

```bash
ixora memories optimize --user-id alice --json > /tmp/plan.json
jq '.proposed_changes' /tmp/plan.json | less    # review
ixora memories optimize --user-id alice --apply
```

### Reset everything for a single user

```bash
ids=$(ixora memories list --user-id alice --limit 500 --json memory_id \
      | jq -r 'map(.memory_id) | join(",")')
ixora memories delete-all --ids "$ids" --user-id alice
```

---

## Gotchas

- **CRUD verbs are `create`/`update`/`delete`**, not `add`/`edit`/`remove`. Same convention as `sessions`.
- **`delete-all` is not a filter sweep.** It's a batch operation over IDs you provide — there's no `--all-for-user` shortcut. Always list-then-delete.
- **`update` replaces, doesn't merge.** Pass the full `--memory` text and the full `--topics` list every time.
- **`optimize` is dry-run by default.** Without `--apply` it returns a plan, never mutates state. Easy to mistake the plan for an applied change.
- **`--user-id` is required for `optimize`.** There's no global "optimize everything" sweep — that would be unsafe at scale.
- **Memories are per-database under per-system DB isolation.** With `IXORA_DB_ISOLATION=per-system` (the default), `alice`'s memories on system `dev` are distinct from `alice`'s on system `prod`. Use `--db-id <db>` or `--system <id>` to target the right one.

---

## Memories vs sessions vs knowledge

| Need | Use |
|---|---|
| "What conversational state is in flight?" | `sessions get <id>` |
| "What facts persist about THIS USER across sessions?" | `memories list --user-id <id>` |
| "What ingested documents can the agent retrieve?" | [`knowledge search`](knowledge.md) |

---

## See also

- [`../docs/runtime/memories.md`](../docs/runtime/memories.md) — canonical command reference
- [`knowledge.md`](knowledge.md) — document ingestion and retrieval
- [`traces-sessions.md`](traces-sessions.md) — sessions and per-run conversation state
