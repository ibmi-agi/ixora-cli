# `ixora docs`

Inspect the AgentOS server's raw HTTP API via its OpenAPI spec at `/openapi.json`. Useful for discovery — every CLI command is built on top of these endpoints, and there are more endpoints than the CLI wraps.

```bash
ixora docs list
ixora docs show <key>
ixora docs spec
```

---

## `list`

Tabulate every endpoint the server exposes.

```bash
ixora docs list
ixora docs list --tag schedules
ixora docs list --json
```

| Flag | Purpose |
|---|---|
| `--tag <name>` | Filter to a single tag (case-insensitive). Tags come from the OpenAPI spec. |

Output columns: `METHOD`, `PATH`, `OPERATION_ID`, `TAG`, `SUMMARY`.

Example:

```
$ ixora docs list --tag agents

┌────────┬──────────────────────────────┬───────────────┬────────┬──────────────────────────┐
│ METHOD │ PATH                         │ OPERATION_ID  │ TAG    │ SUMMARY                  │
├────────┼──────────────────────────────┼───────────────┼────────┼──────────────────────────┤
│ GET    │ /agents                      │ listAgents    │ agents │ List agents              │
│ GET    │ /agents/{id}                 │ getAgent      │ agents │ Get agent details        │
│ POST   │ /agents/{id}/runs            │ runAgent      │ agents │ Run an agent             │
│ POST   │ /agents/{id}/runs/{run_id}   │ continueAgent │ agents │ Continue an agent run    │
└────────┴──────────────────────────────┴───────────────┴────────┴──────────────────────────┘
```

---

## `show <key>`

Show full details for a single endpoint, including parameters, request/response schemas, and a generated `curl` example.

`<key>` is either an `operationId` or a literal path.

```bash
ixora docs show runAgent
ixora docs show /agents/{id}/runs            # path
ixora docs show /eval-runs --method POST     # disambiguate when a path has multiple methods
```

| Flag | Purpose |
|---|---|
| `--method <m>` | Required when `<key>` is a path with more than one HTTP method. |

Default fields rendered: `Method`, `Path`, `Operation ID`, `Tag`, `Summary`, `Description`, `Parameters`, `Request Body`, `Response Body`, `Curl Example`.

The generated `curl` substitutes the resolved base URL of the targeted system:

```
Curl Example:
  curl -X POST http://localhost:18000/agents/sql-agent/runs \
    -H 'Content-Type: application/json' \
    -d '{"message":"...","session_id":"...","user_id":"..."}'
```

JSON output (`--json`) returns the same payload as a single object.

---

## `spec`

Dump the raw OpenAPI JSON. Designed to be piped to `jq` or saved.

```bash
ixora docs spec > openapi.json
ixora docs spec | jq '.info.version'
ixora docs spec | jq '.paths | keys | length'
```

No flags — just stdout.

---

## When to use this

- The CLI doesn't wrap an endpoint you need. Inspect it here, then call it with `curl` (or the SDK).
- Building a custom client / dashboard: grab the spec via `docs spec`.
- Cross-checking a version: `docs spec | jq '.info'` tells you exactly what schema the server is serving.

---

## See also

- [`status.md`](status.md) — high-level resource overview
- [`../global-options.md`](../global-options.md) — `--url`, `--system`, `--key` for cross-system inspection
