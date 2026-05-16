# `ixora knowledge`

Manage the knowledge base — upload documents, search them, inspect processing status.

```bash
ixora knowledge upload [file_path] | --from-url <url>
ixora knowledge list
ixora knowledge get <content_id>
ixora knowledge search "<query>"
ixora knowledge status <content_id>
ixora knowledge delete <content_id>
ixora knowledge delete-all
ixora knowledge config
```

All subcommands accept:

| Flag | Purpose |
|---|---|
| `--db-id <id>` | Database ID |
| `--knowledge-id <id>` | Knowledge base ID (when the system has more than one) |

---

## `upload`

Upload from a local file or a URL. Exactly one source is required.

```bash
ixora knowledge upload ./docs/db2-tuning.pdf
ixora knowledge upload ./notes.md --name "Indexing notes" --description "Internal tips"
ixora knowledge upload --from-url https://example.com/spec.pdf
ixora knowledge upload ./big.pdf --knowledge-id kb_main
```

| Flag | Purpose |
|---|---|
| `--from-url <url>` | Upload from URL instead of file. **Renamed from agno-cli's `--url`** to avoid colliding with the global `--url` endpoint override. |
| `--name <name>` | Content display name |
| `--description <desc>` | Content description |
| `--db-id <id>` | Database ID |
| `--knowledge-id <id>` | Knowledge base ID |

Processing is asynchronous. After upload, the CLI prints the content ID and hints how to poll:

```
✓ Content uploaded: kn_abc123  (status: queued)
  Check status: ixora knowledge status kn_abc123
```

---

## `list`

```bash
ixora knowledge list
ixora knowledge list --sort-by created_at --sort-order desc
ixora knowledge list --json id,name,status
```

| Flag | Default | Purpose |
|---|---|---|
| `--limit <n>` | `20` | Page size |
| `--page <n>` | `1` | Page number |
| `--sort-by <field>` | — | Sort field |
| `--sort-order asc\|desc` | — | Sort direction |
| `--db-id <id>` | — | Database ID |
| `--knowledge-id <id>` | — | Knowledge base ID |

Output columns: `ID`, `NAME`, `STATUS`, `TYPE`.

---

## `get <content_id>`

```bash
ixora knowledge get kn_abc
ixora knowledge get kn_abc --json     # full payload including raw content
```

Default fields: `ID`, `Name`, `Status`, `Type`, `Content` (truncated to 200 chars). Use `--json` to see the full content.

---

## `search "<query>"`

Run a search across the knowledge base.

```bash
ixora knowledge search "DB2 for i indexing"
ixora knowledge search "indexing" --search-type hybrid --max-results 10
ixora knowledge search "security audit" --search-type keyword
```

| Flag | Default | Purpose |
|---|---|---|
| `--search-type <t>` | `vector` | `vector`, `keyword`, or `hybrid` |
| `--max-results <n>` | — | Server-side limit |
| `--limit <n>` | `20` | Page size |
| `--page <n>` | `1` | Page number |
| `--db-id <id>` | — | Database ID |
| `--knowledge-id <id>` | — | Knowledge base ID |

Output columns: `ID`, `CONTENT` (truncated to 80 chars), `NAME`, `SCORE` (reranking score where available).

---

## `status <content_id>`

Check processing status for a piece of content.

```bash
ixora knowledge status kn_abc
ixora knowledge status kn_abc --json
```

Default fields: `Content ID`, `Status`, `Progress`, `Error`. Typical statuses: `queued`, `processing`, `ready`, `error`.

---

## `delete <content_id>`

```bash
ixora knowledge delete kn_abc
```

---

## `delete-all`

Drop every piece of content in the knowledge base.

```bash
ixora knowledge delete-all
ixora knowledge delete-all --knowledge-id kb_old
```

> Irreversible unless the upstream documents are still available.

---

## `config`

View the knowledge base configuration — which readers (file-type parsers), chunkers, and vector DBs are wired up.

```bash
ixora knowledge config
ixora knowledge config --json
```

Output fields: `Readers`, `Chunkers`, `Vector DBs`. Useful when debugging "why did this upload fail?" — verify the file type has a matching reader.

---

## Common flows

### Bulk-ingest a directory and wait for processing

```bash
for f in ./docs/*.md; do
  id=$(ixora knowledge upload "$f" --json | jq -r '.id')
  echo "uploaded $f as $id"
  until [ "$(ixora knowledge status "$id" --json | jq -r '.status')" = "ready" ]; do
    sleep 2
  done
  echo "ready: $id"
done
```

### Search and pipe top hits to a follow-up agent run

```bash
top=$(ixora knowledge search "QSYS job logs" --max-results 5 --json | jq -r '.data[].content')
ixora agents run sql-agent "Summarize this context: $top"
```

---

## See also

- [`memories.md`](memories.md) — short-form facts (the knowledge base is for documents)
- [`status.md`](status.md) — see which knowledge bases the AgentOS exposes (`KNOWLEDGE` section)
