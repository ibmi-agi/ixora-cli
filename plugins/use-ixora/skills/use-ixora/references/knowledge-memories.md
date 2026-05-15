# Knowledge and Memories — `ixora knowledge` / `ixora memories`

> **For exact flags, run `ixora knowledge <verb> --help` and `ixora memories <verb> --help`.** This reference covers workflows, gotchas, and non-obvious patterns — it does not transcribe every flag.

**Knowledge** = ingested content (files, URLs) chunked and embedded into a vector store. **Memories** = long-lived facts the system has stored about a user (preferences, learned patterns).

Both target the resolved system. Use `--system <id>` to pick a specific one; `--url <url>` to skip resolution and hit an endpoint directly.

## knowledge

Verbs: `upload`, `list`, `get`, `search`, `status`, `delete`, `delete-all`, `config`.

### The multi-KB gotcha

If the server has **more than one knowledge base**, every command that touches content requires `--knowledge-id <id>` (or `--db-id <id>`). Without it, the server responds:

```
Error: Invalid request: db_id or knowledge_id query parameter is required
when using multiple knowledge bases.
Available IDs: ['<uuid1>', '<uuid2>', ...]
```

Find IDs with:

```bash
ixora status -o json | jq '.knowledge.knowledge_instances[] | {id, name}'
```

The flat `--json fields` projection doesn't reach nested keys — use `-o json` plus `jq` for anything deeper than a top-level field. Save the chosen ID in a shell var:

```bash
KB=0775d089-7499-907f-419c-4d8383be77e4
```

### upload — file path OR URL

Two modes, never both:

```bash
# from local file
ixora knowledge upload ./notes/q2-analysis.md --knowledge-id $KB --name "Q2 Analysis"

# from a remote URL — flag is --from-url, NOT --url
ixora knowledge upload --from-url https://example.com/paper.pdf \
  --knowledge-id $KB --description "External paper"
```

**Critical**: the URL-upload flag is `--from-url`, not `--url`. The top-level `--url` flag overrides the AgentOS endpoint, so using it for an upload silently retargets the entire request and the upload fails against the wrong host.

Ingestion (chunking + embedding) is async. Poll status by content ID:

```bash
ixora knowledge status <content_id>
```

### list, get, search, delete, delete-all, config

```bash
ixora knowledge list   --knowledge-id $KB --limit 20 --json id,name,type,status
ixora knowledge get    <content_id> --knowledge-id $KB
ixora knowledge search "monthly revenue pattern" --knowledge-id $KB --max-results 5
ixora knowledge delete <content_id> --knowledge-id $KB
ixora knowledge delete-all --knowledge-id $KB                # DANGER — wipes the KB
ixora knowledge config --knowledge-id $KB                    # embedder, chunk strategy, vector DB
```

`search` has `--search-type vector | keyword | hybrid` (default `vector`). Hybrid blends vector + BM25; keyword is exact-token only.

```bash
# Project specific fields on search results (v0.3.3+)
ixora knowledge search "revenue" --knowledge-id $KB --json content,name,meta_data
```

### Recipes

```bash
# what was just indexed?
ixora knowledge list --knowledge-id $KB --sort-by created_at --sort-order desc --limit 10

# find all SQL files in a KB
ixora knowledge list --knowledge-id $KB --limit 100 --json id,name \
  | jq '.[] | select(.name | endswith(".sql"))'

# audit source paths
ixora knowledge list --knowledge-id $KB --limit 200 --json name,metadata
```

## memories

User memories — long-lived facts keyed to a `user_id` (optionally scoped to `agent_id` or `team_id`).

Verbs: `list`, `get`, `create`, `update`, `delete`, `delete-all`, `topics`, `stats`, `optimize`.

### list / CRUD

```bash
ixora memories list   --user-id <id> [--agent-id <id>] [--team-id <id>] [--search <text>] [--topics csv]
ixora memories get    <memory_id>
ixora memories create --user-id <id> --memory "User prefers concise answers" --topics "preferences,style"
ixora memories update <memory_id> --memory "..." --topics "..."
ixora memories delete <memory_id>
```

CRUD verbs are `create` / `update` / `delete` (not `add` / `edit` / `remove`).

### delete-all is batch-by-ID, NOT filter-based

```bash
ixora memories delete-all --ids id1,id2,id3 [--user-id <id>]
```

`--ids` is **required**. `--user-id` narrows the delete to that user's memories within those IDs — it does not enable a "delete everything for this user" shortcut. To purge by filter: list → extract IDs → call `delete-all`:

```bash
ids=$(ixora memories list --user-id alice --limit 200 --json memory_id | jq -r 'map(.memory_id) | join(",")')
ixora memories delete-all --ids "$ids" --user-id alice
```

### topics / stats / optimize

```bash
ixora memories topics   --user-id <id>     # distinct topics for a user
ixora memories stats    --user-id <id>     # counts / summary
ixora memories optimize --user-id <id>     # agentic dedup / merge
```

### Recipes

```bash
# what does the system "remember" about a specific user + agent combo?
ixora memories list --user-id <user> --agent-id ibmi-system-health --limit 50

# search memories for a keyword
ixora memories list --user-id <user> --search "QSECURITY"

# topic breakdown
ixora memories topics --user-id <user>
```

## Knowledge vs memories — when to reach for which

| Need | Use |
|---|---|
| "Has this document been ingested?" | `knowledge list` |
| "Find the chunks relevant to a query." | `knowledge search` |
| "Where did the model get this answer?" | `knowledge search` with the same query |
| "What does the system know about THIS USER?" | `memories list --user-id ...` |
| "What categories of facts has it learned?" | `memories topics --user-id ...` |
| "The memory store is bloated — dedup it." | `memories optimize --user-id ...` |
