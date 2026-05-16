# Knowledge base — `ixora knowledge`

> Canonical flag reference: [`../docs/runtime/knowledge.md`](../docs/runtime/knowledge.md). This page covers the multi-KB gotcha, the `--from-url` vs `--url` trap, and recipe-driven workflows.

**Knowledge** = ingested content (files, URLs) chunked and embedded into a vector store. For long-lived facts about a specific user, see [`memories.md`](memories.md) instead.

Verbs: `upload`, `list`, `get`, `search`, `status`, `delete`, `delete-all`, `config`. Each targets the resolved system (`--system` / `--url` apply).

---

## The multi-KB gotcha

If the server has **more than one knowledge base**, every command that touches content requires `--knowledge-id <id>` (or the equivalent `--db-id <id>`). Without it:

```
Error: Invalid request: db_id or knowledge_id query parameter is required
when using multiple knowledge bases.
Available IDs: ['<uuid1>', '<uuid2>', ...]
```

Find IDs with:

```bash
ixora status -o json | jq '.knowledge.knowledge_instances[] | {id, name}'
```

The flat `--json fields` projection only reaches top-level keys — use `-o json` plus `jq` for anything deeper. Save the chosen ID in a shell var:

```bash
KB=0775d089-7499-907f-419c-4d8383be77e4
```

If `ixora status` shows exactly one KB, `--knowledge-id` is optional and the server picks it implicitly.

---

## `upload` — file path OR URL (never both)

```bash
# from a local file (positional)
ixora knowledge upload ./notes/q2-analysis.md --knowledge-id $KB --name "Q2 Analysis"

# from a remote URL — flag is --from-url, NOT --url
ixora knowledge upload --from-url https://example.com/paper.pdf \
  --knowledge-id $KB --description "External paper"
```

**Critical**: the URL-upload flag is `--from-url`. The **top-level** `--url` is the AgentOS endpoint override — using `--url` for an upload silently retargets the entire request to that host and the upload fails (often with a 404) against the wrong server.

Ingestion is async. Poll by content ID:

```bash
ixora knowledge status <content_id>
ixora knowledge status <content_id> --json | jq .status
```

Statuses: `queued`, `processing`, `ready`, `error`.

---

## `list`, `get`, `search`, `delete`, `delete-all`, `config`

```bash
ixora knowledge list   --knowledge-id $KB --limit 20 --json id,name,type,status
ixora knowledge get    <content_id> --knowledge-id $KB
ixora knowledge search "monthly revenue pattern" --knowledge-id $KB --max-results 5
ixora knowledge delete <content_id> --knowledge-id $KB
ixora knowledge delete-all --knowledge-id $KB                # DANGER — wipes the KB
ixora knowledge config --knowledge-id $KB                    # embedder, chunkers, vector DB
```

### Search modes

`search` has `--search-type vector | keyword | hybrid` (default `vector`):

| Mode | Behavior |
|---|---|
| `vector` | Embedding-based semantic match. Best for paraphrased queries. |
| `keyword` | Exact-token (BM25-style). Best for proper nouns, code identifiers. |
| `hybrid` | Blends vector + keyword with reranking. Best general-purpose default; slowest. |

```bash
ixora knowledge search "QSECURITY recommended values" --knowledge-id $KB --search-type hybrid
ixora knowledge search "revenue" --knowledge-id $KB --json content,name,meta_data
```

---

## Recipes

### Bulk ingest a directory and wait for processing

```bash
for f in ./docs/*.md; do
  id=$(ixora knowledge upload "$f" --knowledge-id $KB --json | jq -r '.id')
  echo "uploaded $f as $id"
  until [ "$(ixora knowledge status "$id" --json | jq -r '.status')" = "ready" ]; do
    sleep 2
  done
  echo "ready: $id"
done
```

### What was just indexed?

```bash
ixora knowledge list --knowledge-id $KB --sort-by created_at --sort-order desc --limit 10
```

### Find all SQL files in a KB

```bash
ixora knowledge list --knowledge-id $KB --limit 100 --json id,name \
  | jq '.[] | select(.name | endswith(".sql"))'
```

### Search and pipe top hits to a follow-up agent run

```bash
top=$(ixora knowledge search "QSYS job logs" --knowledge-id $KB --max-results 5 --json \
       | jq -r '.data[].content')
ixora agents run sql-agent "Summarize this context: $top"
```

### Audit source paths and metadata

```bash
ixora knowledge list --knowledge-id $KB --limit 200 --json name,metadata
```

---

## Knowledge vs memories — when to reach for which

| Need | Use |
|---|---|
| "Has this document been ingested?" | `knowledge list` |
| "Find the chunks relevant to a query." | `knowledge search` |
| "Where did the model get this answer?" | `knowledge search` with the same query |
| "What does the system know about THIS USER?" | [`memories list --user-id ...`](memories.md) |
| "What categories of facts has it learned?" | [`memories topics --user-id ...`](memories.md) |

---

## Gotchas

- **`--from-url` not `--url`.** The latter is the AgentOS endpoint override.
- **`delete-all` is irreversible.** No tombstone, no soft-delete. Re-ingest from the original sources if you need it back.
- **Reader / chunker mismatch silently fails.** If `upload` reports `ready` but `search` finds nothing for content you know is there, check `ixora knowledge config --knowledge-id $KB` — the file extension must have a matching reader, and the chunker has to be compatible.
- **The flat `--json fields` projection can't reach nested keys.** Use `-o json | jq` for `knowledge_instances[].name` and similar nested paths.

---

## See also

- [`../docs/runtime/knowledge.md`](../docs/runtime/knowledge.md) — canonical command reference
- [`memories.md`](memories.md) — long-lived per-user facts
- [`../docs/runtime/status.md`](../docs/runtime/status.md) — discover the `knowledge_instances` list
- [`docs.md`](docs.md) — discover knowledge-related HTTP endpoints not wrapped by the CLI
