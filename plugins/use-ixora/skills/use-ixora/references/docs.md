# Docs — `ixora docs`

> **For exact flags, run `ixora docs <verb> --help`.** This reference covers the discoverability workflow and gotchas — it does not transcribe every flag.

`ixora docs` reads the AgentOS server's own OpenAPI spec (`/openapi.json`) so you can explore the raw HTTP API without leaving the terminal. Useful when no SDK / CLI wrapper exists for what you need, when you want a copy-pasteable curl, or when you need to know what fields the server actually returns so you can `--json <fields>` for them. Verbs: `list`, `show`, `spec`. Each targets the resolved system.

## docs list

```bash
ixora docs list                                       # every endpoint, default table
ixora docs list --tag Evals                           # filter by OpenAPI tag (case-insensitive)
ixora docs list --json method,path,operation_id       # for piping to jq / fzf
```

Tags you'll see: `Agents`, `Teams`, `Workflows`, `Evals`, `Sessions`, `Memory`, `Knowledge`, `Approvals`, `Schedules`, `Traces`, `Metrics`, `Database`, `Health`, `Core`, `Registry`, `A2A`, `Components`, `auth`, `connections`.

## docs show — details + curl example

Lookup by `operationId` first; falls back to path. When the same path has multiple methods (GET/POST/DELETE on `/eval-runs`, for instance) pass `--method`.

```bash
ixora docs show run_eval                              # by operationId
ixora docs show /health                               # by path (single method)
ixora docs show /eval-runs --method POST              # disambiguate
ixora docs show run_eval --json | jq                  # full resolved op object
```

Output includes: method, path, summary, parameters, the fully-deref'd request/response JSON schemas, and a copy-pasteable curl example:

```
curl -X POST \
  "http://localhost:8000/eval-runs?db_id=<db_id>&table=<table>" \
  -H "Authorization: Bearer $AGENTOS_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "agent_id": "", "eval_type": "", "input": "", ... }'
```

The body stub is generated from the request schema (with `example`/`default`/type fallbacks). The `$AGENTOS_KEY` placeholder is **never substituted** — set it via env var when running.

## docs spec — raw OpenAPI passthrough

```bash
ixora docs spec | jq '.paths | keys | length'                   # endpoint count
ixora docs spec | jq '.components.schemas.EvalRunInput'         # full request schema
ixora docs spec | jq '.paths."/agents/{agent_id}/runs" | keys'  # methods on one path
ixora docs spec > /tmp/ixora-openapi.json                       # save for offline
```

Useful when you want the whole spec, not one endpoint at a time.

## Discoverability pattern — use `docs` before writing a curl

When the SDK / CLI doesn't wrap an endpoint and you need to script raw HTTP:

```bash
# 1. Find what's available
ixora docs list --tag Schedules

# 2. Pick the verb you want
ixora docs show schedule_create --method POST          # or by operationId

# 3. The printed curl is the spine of your script
#    — replace <placeholders>, set $AGENTOS_KEY, you're done
```

This is also the right move when the CLI's table-mode output omits a field you need — `docs show` reveals everything the server actually returns, so you know what to ask for via `--json <fields>` projection.

## Gotchas

- **`docs show` curl uses a `$AGENTOS_KEY` placeholder.** It is intentionally never substituted with the real key, even though the resolved key is known. Set the env var when running the curl yourself.
- **`docs spec` can be 1–3 MB on a mature server.** Fine as a one-shot, but pipe to `jq` rather than scrolling.
- **`docs` doesn't list the `/docs` (Swagger UI) or `/openapi.json` endpoints themselves** — those aren't in the OpenAPI spec.
- **Auth on `/openapi.json`**: most deployments leave it open, but a hardened one may 401. The same `--key` / `SYSTEM_<ID>_AGENTOS_KEY` plumbing applies; an auth error will surface as the usual "Authentication failed" message.
- **`docs show` body stubs are placeholders, not validated examples.** Required fields appear as empty strings (`""`); enums appear as their first value. Replace placeholders with real values before running the curl.
