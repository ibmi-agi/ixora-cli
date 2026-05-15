# Knowledge and Memories — `ixora knowledge` / `ixora memories`

**Knowledge** = ingested content (files, URLs) chunked and embedded into a vector store. **Memories** = long-lived facts the system has stored about a user (preferences, learned patterns).

> Both target the resolved system. Use `--system <id>` to pick a specific one.

## knowledge

Eight subcommands: `upload`, `list`, `get`, `search`, `status`, `delete`, `delete-all`, `config`.

### The multi-KB gotcha

If the server has **more than one knowledge base**, every command that touches content requires `--knowledge-id <id>` (or `--db-id <id>`). Without it, the server returns:

```
Error: Invalid request: db_id or knowledge_id query parameter is required
when using multiple knowledge bases.
Available IDs: ['<uuid1>', '<uuid2>', ...]
```

Discover the IDs via:

```bash
ixora status --json knowledge
# look under .knowledge.knowledge_instances[*].id + .name
```

Save the ID in a shell var to avoid retyping:

```bash
KB=0775d089-7499-907f-419c-4d8383be77e4
```

### knowledge list

```
ixora knowledge list [options]

  --knowledge-id <id>   (required when >1 KB)
  --db-id <id>
  --limit <n>           default 20
  --page <n>
  --sort-by <field>
  --sort-order asc|desc
```

Fields: `id`, `name`, `description`, `type` (Text|PDF|URL|...), `size`, `linked_to`, `metadata` (category, filename, extension, source_path), `access_count`, `status` (pending|processing|completed|failed), `status_message`, `created_at`, `updated_at`.

```bash
ixora knowledge list --knowledge-id $KB --limit 20 --json id,name,type,status
```

### knowledge search

```
ixora knowledge search [options] <query>

  --knowledge-id <id>       (required when >1 KB)
  --search-type <type>      vector | keyword | hybrid (default: vector)
  --max-results <n>
  --limit <n>               default 20
  --page <n>
  --db-id <id>
```

Returns chunks with `content`, `name` (source filename), `meta_data` (chunk index, category, similarity_score), `usage` (token counts). Similarity scores live in `meta_data.similarity_score`.

```bash
# vector search (default)
ixora knowledge search --knowledge-id $KB --max-results 5 "monthly revenue pattern"

# hybrid (vector + BM25)
ixora knowledge search --knowledge-id $KB --search-type hybrid --max-results 10 "revenue"

# keyword only (exact token matches)
ixora knowledge search --knowledge-id $KB --search-type keyword "TOYSTORE3"
```

### knowledge upload

Two modes: local file path OR remote URL.

```
ixora knowledge upload [file_path] [options]
                       OR
ixora knowledge upload --url <url> [options]

  --name <name>          content display name
  --description <desc>
  --knowledge-id <id>
  --db-id <id>
```

```bash
ixora knowledge upload ./notes/q2-analysis.md --knowledge-id $KB --name "Q2 Analysis"
ixora knowledge upload --url https://example.com/paper.pdf --knowledge-id $KB \
  --description "External paper"
```

After upload, poll status — ingestion (chunking + embedding) is async:

```bash
ixora knowledge status <content_id>
```

### knowledge get / delete / delete-all / config

```bash
ixora knowledge get <content_id> --knowledge-id $KB
ixora knowledge delete <content_id> --knowledge-id $KB
ixora knowledge delete-all --knowledge-id $KB        # DANGER — wipes the whole KB
ixora knowledge config --knowledge-id $KB            # embedder model, chunk strategy, vector DB settings
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

### memories list

```
ixora memories list [options]

  --user-id <id>        filter by user
  --team-id <id>        filter by team
  --agent-id <id>       filter by agent
  --search <content>    substring search over memory content
  --topics <csv>        topic filter (comma-separated)
  --limit <n>           page size (default 20)
  --page <n>            page number
  --sort-by <field>
  --sort-order asc|desc
  --db-id <id>
```

Each row: `memory_id`, `memory` (content string), `topics` (array), `agent_id`, `team_id`, `user_id`, `created_at`, `updated_at`.

### memories CRUD + extras

```bash
ixora memories create --user-id me --memory "User prefers concise answers" --topics "preferences,style"
ixora memories get <memory_id>
ixora memories update <memory_id> --memory "..." --topics "..."
ixora memories delete <memory_id>
ixora memories delete-all --user-id me
ixora memories topics --user-id me                   # list distinct topics for a user
ixora memories stats --user-id me                    # counts/summary
ixora memories optimize --user-id me                 # agentic dedup/merge
```

**Gotcha**: `memories create`, not `memories add`. Same pattern everywhere — `update` not `edit`, `delete` not `remove`.

### Recipes

```bash
# what does the system "remember" about a specific user + agent combo?
ixora memories list --user-id ajshedivyaj@gmail.com --agent-id ibmi-system-health --limit 50

# search memories for a keyword
ixora memories list --user-id ajshedivyaj@gmail.com --search "QSECURITY"

# topic breakdown
ixora memories topics --user-id ajshedivyaj@gmail.com
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
