# Observability — `status`, `health`, `metrics`, `approvals`, `components`, `models`, `registries`, `databases`

> For exact flag tables on any subcommand, see the matching page under [`../docs/runtime/`](../docs/runtime/). This page covers the workflows and "when to use which" decisions.

These commands answer "what's running, is it healthy, and what did it produce?" Each targets the resolved system (`--system` / `--url` apply).

---

## `ixora status` — resource overview

What's loaded on the targeted AgentOS: databases, storage table mapping, agents, teams, workflows, knowledge bases, exposed interfaces.

```bash
ixora status                                                    # full table
ixora status --json                                             # raw /config payload
ixora --system prod status -o json | jq '.knowledge.knowledge_instances'
```

Use this **first** when wiring an external tool, debugging "why isn't my agent loading," or cross-checking with `ixora stack components list` (the image's manifest).

Compared to `ixora stack status`: stack-status is *containers*, runtime-status is *what the API thinks is loaded*. They can disagree (e.g. compose says api-default is Up but the agent profile was misconfigured and zero agents loaded).

Source: [`../docs/runtime/status.md`](../docs/runtime/status.md).

---

## `ixora health` — uptime + latency

Pings `/health`. Exits non-zero when unhealthy — wire into scripts and monitors.

```bash
ixora health                                                    # table form
ixora --system prod health --json                               # JSON; stable across versions
ixora --system prod health > /dev/null || echo "prod unhealthy"
```

Output fields (`--json`): `ok`, `status`, `url`, `system_id`, `instantiated_at`, `uptime_seconds`, `latency_ms`.

Exit codes:

| Condition | Exit |
|---|---|
| `status == "ok"` | `0` |
| anything else (incl. HTTP/network errors) | `1` |

Source: [`../docs/runtime/health.md`](../docs/runtime/health.md).

---

## `ixora metrics` — daily rollups

```bash
ixora metrics get                                               # last window the server tracks
ixora metrics get --start-date 2026-05-01 --end-date 2026-05-15
ixora metrics get --start-date 2026-05-01 --json | jq '.data[]'
ixora metrics refresh                                           # async server-side rebuild
```

Output columns: `DATE`, `AGENT_RUNS`, `TEAM_RUNS`, `WORKFLOW_RUNS`, `USERS`. Window inclusive on both ends.

Run `metrics refresh` after backfilling traces or when daily aggregates look stale; rerun `metrics get` after a short pause.

For per-run / per-trace detail, use `traces` instead — `metrics` is daily granularity.

Source: [`../docs/runtime/metrics.md`](../docs/runtime/metrics.md).

---

## `ixora approvals` — out-of-band approval workflow

Distinct from the inline `agents continue --confirm` pause flow. Approvals exist as first-class objects when a component (typically a workflow) emits one programmatically.

```bash
ixora approvals list                                            # paginated
ixora approvals list --status pending --agent-id sql-agent
ixora approvals get <id>
ixora approvals resolve <id> --status approved --resolved-by alice
ixora approvals resolve <id> --status rejected --resolved-by alice \
  --resolution-data '{"reason":"insufficient justification"}'
```

| Surface | Use when | How to resolve |
|---|---|---|
| Inline `agents continue` | An agent run paused mid-execution on a tool call | `ixora agents continue <agent_id> <run_id> --confirm \| --reject` |
| `approvals list/resolve` | A generic approval object was emitted (any component can emit one) | `ixora approvals resolve <id> --status approved` |

Not sure which? Check `ixora traces get <run_id>` — it includes the approval ID (if any) in trace metadata.

Source: [`../docs/runtime/approvals.md`](../docs/runtime/approvals.md).

---

## `ixora components` — agents/teams/workflows as data

Distinct from `ixora stack components list`, which inspects the **image manifest**. This is the **live, mutable** component API on the running AgentOS.

```bash
ixora components list                                           # paginated
ixora components list --type agent
ixora components get <id>
ixora components create --name "QSYS Audit" --type agent \
  --config '{"model":"anthropic:claude-sonnet-4-6","tools":["db.query"]}'
ixora components update <id> --stage published
ixora components delete <id>

# Versioned configuration
ixora components config list <id>
ixora components config create <id> --config '<json>'
ixora components config update <id> <version> --config '<json>'    # drafts only — published is immutable
ixora components config delete <id> <version>
```

`STAGE` is typically `draft` or `published`. **Published versions are immutable** — to change one, create a new draft and promote it.

Use this when authoring or editing components at runtime (rare — most components are baked into the image). For "what agents does this image declare?" use `ixora stack components list` instead.

Source: [`../docs/runtime/components.md`](../docs/runtime/components.md).

---

## `ixora models` — runtime model registry

The models the **running AgentOS** can load.

```bash
ixora models list
ixora models list --limit 50
```

Output columns: `ID` (e.g. `anthropic:claude-sonnet-4-6`), `PROVIDER`.

Use these IDs in `evals run --model-id ...`, `components create/update --config '{"model":"..."}'`, or `IXORA_AGENT_MODEL` / `IXORA_TEAM_MODEL` env vars (set via `ixora stack models set`).

Not the same as `ixora stack models show|set`, which manages the **provider** configuration for the local deployment. See [`../docs/runtime/models.md`](../docs/runtime/models.md) and [`../docs/stack/models.md`](../docs/stack/models.md).

---

## `ixora registries list` — versioned references

Versioned registry entries — typically published component references.

```bash
ixora registries list
ixora registries list --type agent
ixora registries list --name sql-agent --json
```

Output columns: `ID`, `NAME`, `TYPE`, `VERSION`.

The registry is for **published versions** — distinct from the **live components** on the system. Use `components.md` for the live set, `registries.md` for the version history.

Source: [`../docs/runtime/registries.md`](../docs/runtime/registries.md).

---

## `ixora databases migrate <db_id>` — apply pending migrations

```bash
ixora databases migrate ai_default
ixora databases migrate ai_prod --target-version 12
```

Most users never run this — `ixora stack upgrade` triggers migrations automatically on API startup. Reach for `databases migrate` when:

- A migration failed during `stack upgrade` and the API container is in a half-migrated state
- You manually created a new `ai_<id>` Postgres database and need to apply migrations
- You're scripting migrations in CI

Source: [`../docs/runtime/databases.md`](../docs/runtime/databases.md).

---

## Quick recipes

### Confirm a freshly restarted stack is healthy

```bash
ixora stack status                                  # containers Up?
ixora health --json | jq '.ok'                      # API responding?
ixora status -o json | jq '.agents | length'        # agents loaded?
```

### Find unhealthy systems across a multi-system deployment

```bash
ixora stack system list --json | jq -r '.[].id' | while read id; do
  ixora --system "$id" health --json | jq --arg id "$id" '{system:$id, ok, latency_ms}'
done
```

### Pending approvals across all systems

```bash
for id in $(ixora stack system list --json | jq -r '.[].id'); do
  ixora --system "$id" approvals list --status pending --json \
    | jq --arg id "$id" '.data[] | {system:$id, id, type, created_at}'
done
```

### Weekly cost rollup

```bash
ixora metrics get --start-date 2026-05-08 --end-date 2026-05-15 --json \
  | jq '[.data[] | .agent_runs + .team_runs + .workflow_runs] | add'
```

---

## Status / health / traces / metrics — which to use

| Need | Use |
|---|---|
| "Is the AgentOS responding?" | `ixora health` |
| "What's loaded on it?" | `ixora status` |
| "What's running on the host?" | `ixora stack status` |
| "What ran today / this week?" | `ixora metrics get` |
| "What just failed?" | `ixora traces list --status error` |
| "What did this specific run do?" | `ixora traces get <trace_id>` |
| "Who's waiting on me to approve something?" | `ixora approvals list --status pending` |

---

## See also

- [`../docs/runtime/status.md`](../docs/runtime/status.md), [`../docs/runtime/health.md`](../docs/runtime/health.md), [`../docs/runtime/metrics.md`](../docs/runtime/metrics.md), [`../docs/runtime/approvals.md`](../docs/runtime/approvals.md), [`../docs/runtime/components.md`](../docs/runtime/components.md), [`../docs/runtime/models.md`](../docs/runtime/models.md), [`../docs/runtime/registries.md`](../docs/runtime/registries.md), [`../docs/runtime/databases.md`](../docs/runtime/databases.md)
- [`traces-sessions.md`](traces-sessions.md) — per-run debug detail
- [`agents-teams-workflows.md`](agents-teams-workflows.md) — the inline approval flow via `agents continue`
