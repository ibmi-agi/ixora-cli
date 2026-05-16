---
name: use-ixora
description: >
  Operate the Ixora platform via the `ixora` CLI: install, start, stop, restart,
  and upgrade the local stack; add, remove, list, and switch between systems
  (managed compose stack OR external AgentOS URL via the `kind: managed | external`
  discriminator); configure the model provider; list and run agents, teams, and
  workflows; inspect traces, sessions, memories, and the knowledge base; check
  health, status, and metrics; edit per-system component profiles (Full vs Custom);
  manage per-system `SYSTEM_<ID>_*` env vars in `~/.ixora/.env`; tail container
  logs; and pin or bump the deployed image version. Use this skill whenever the
  user mentions ixora, Ixora, AgentOS, the ixora stack, agents, teams, workflows,
  traces, sessions, memories, the knowledge base, or anything connected to an
  ixora system — even in passing and even if they don't explicitly ask for an
  action.
allowed-tools: Bash(ixora:*), Bash(which:*), Bash(command:*), Bash(docker:*), Bash(podman:*), Bash(curl:*), Bash(cat:*), Bash(ls:*), Bash(grep:*), Bash(tail:*)
---

# use-ixora

The `ixora` binary exposes **two command trees** with different targeting:

- `ixora stack <cmd>` — local stack lifecycle (install / start / stop / config / multi-system / models / logs). Targets the local deployment directly; ignores `--system`.
- `ixora <runtime> <cmd>` — talk to a running AgentOS (`agents`, `teams`, `workflows`, `traces`, `sessions`, `memories`, `knowledge`, plus `evals`, `docs`, `approvals`, `schedules`, `metrics`, `databases`, `registries`, `components`, `models`, `status`, `health`). Resolves a target system from `~/.ixora/ixora-systems.yaml`.

The runtime commands are **plural** (`ixora agents list`, not `ixora agent list`). Memory and session CRUD verbs are `create`/`update`/`delete` (not `add`/`edit`/`remove`).

## Discoverability — prefer `--help` over guessing

`ixora` is fully self-documenting. Whenever the exact flag set for a command matters:

```bash
ixora --help                          # top-level options (incl. --profile, --system, --json, --runtime)
ixora stack --help                    # stack subcommand list
ixora stack <cmd> --help              # e.g. `ixora stack system add --help`
ixora <runtime> --help                # e.g. `ixora traces --help`
ixora <runtime> <verb> --help         # e.g. `ixora traces list --help`
```

Use this instead of recalling flags from memory. The references below cover *workflows and gotchas* — they intentionally don't transcribe every flag.

## System resolution (the part `--help` won't tell you)

Every `ixora <runtime>` invocation needs a target. The order:

| Inputs | Outcome |
|---|---|
| `--url <url>` supplied | Skip resolution entirely; hit that URL. |
| `--system <id>` supplied | Always wins. |
| 1 system available | Implicit pick — no flag needed. |
| 2+ available, default set | Use the default (`ixora stack system default <id>`). |
| 2+ available, no default | **Error** — `--system <id>` required. |

"Available" = managed systems with running containers **plus all external systems** (externals are always considered available — no docker check). `ixora stack system list` shows the set with KIND + URL columns, default marked `*`.

## References — load when relevant

| Surface | Read |
|---|---|
| Stack install / start / stop / upgrade / logs / config / models / components | [references/stack-lifecycle.md](references/stack-lifecycle.md) |
| Multi-system: add/remove/start/stop, managed vs external, env var naming | [references/systems.md](references/systems.md) |
| Runtime: agents / teams / workflows — list, get, run (streaming + sessions), continue, resume, cancel | [references/agents-teams-workflows.md](references/agents-teams-workflows.md) |
| Debugging: traces + sessions, span trees, the failed-run walkthrough | [references/traces-sessions.md](references/traces-sessions.md) |
| Knowledge base + memories — upload, search, multi-KB rules | [references/knowledge-memories.md](references/knowledge-memories.md) |
| Schedules: cron jobs that fire AgentOS endpoint callbacks — full CRUD, pause/resume, manual trigger, run history | [references/schedules.md](references/schedules.md) |
| Evals: `list / get / run / delete`, eval-type semantics | [references/evals.md](references/evals.md) |
| Docs: raw OpenAPI discovery — `list / show / spec` + curl examples | [references/docs.md](references/docs.md) |

For misc runtime ops (`approvals`, `metrics`, `databases`, `registries`, `health`), `ixora <cmd> --help` is the source of truth.

## Raw HTTP API — use `ixora docs` instead of curl-guessing

The AgentOS server ships an OpenAPI spec at `/openapi.json`. `ixora docs` reads it so you don't have to leave the terminal:

```bash
ixora docs list --tag Evals                     # what eval endpoints exist
ixora docs show run_eval                        # full schema + a curl example
ixora docs show /eval-runs --method POST        # disambiguate when needed
ixora docs spec | jq '.components.schemas.EvalRunInput'   # raw passthrough
```

Reach for this **before** writing a curl against an endpoint the SDK doesn't wrap — `docs show` prints a copy-pasteable curl with placeholders for path params, query params, body fields (stubbed from the schema), and a literal `$AGENTOS_KEY` placeholder for auth. It also resolves `$ref`s inline, so the printed schema is the real shape the server expects. See [references/docs.md](references/docs.md) for the full discoverability pattern.

## Local deployment shape

- **Prereqs:** Node ≥ 20 and a running Docker (or Podman) daemon.
- **Default ports** for the first managed system: API `18000`, DB `15432`, UI `13000`. Each additional managed system shifts the API port by `+1` (system index 1 → `18001`, index 2 → `18002`, …). DB and UI ports are shared across systems.
- **Service names** (what to pass to `stack logs|restart|stop|start <service>`):
  - `agentos-db` — shared Postgres
  - `api-<system_id>` — AgentOS API for each managed system (e.g. `api-default`)
  - `mcp-<system_id>` — MCP server for each managed system (omitted under `--profile cli`)
  - `ui` — Carbon UI (only under `--profile full`)
  - Run `ixora stack status` to see the live list. The SERVICE column shows these canonical names; the NAME column shows compose's container names (`ixora-<service>-<replica>`, e.g. `ixora-api-default-1`). The CLI accepts **either form** — it normalizes container names back to service names — but prefer the SERVICE column form in scripts.
- **Runtime override:** auto-detection tries `docker compose` then `podman compose` then legacy `docker-compose`. Force one with `--runtime docker` / `--runtime podman` on any `stack` command.

## Gotchas

- **`ixora stack start <external-id>` errors out.** Externals have no local lifecycle — they're URLs that runtime commands route to. Only managed systems respond to `system start|stop|restart`.
- **System ID → env var name**: hyphens become underscores, all uppercased. `my-system` → `SYSTEM_MY_SYSTEM_HOST`, `SYSTEM_MY_SYSTEM_AGENTOS_KEY`. Write with `ixora stack config set <key> <value>`.
- **`--profile cli` skips the MCP container.** Sets `IXORA_CLI_MODE=true`; agents reach IBM i via the bundled `ibmi` CLI directly using stored `SYSTEM_<ID>_*` creds. PASE is unavailable in this mode.
- **Profile is sticky.** Once set by `stack start --profile <name>`, subsequent `stop|status|logs|restart|upgrade` calls without `--profile` keep the same shape. Pass `--profile` again to switch.
- **Per-system DB isolation is the default.** Each system gets its own `ai_<id>` Postgres database inside the shared `agentos-db` container. Consolidate with `ixora stack config set IXORA_DB_ISOLATION shared && ixora stack restart`.
- **Custom component profiles only apply when `mode: custom`.** They live in `~/.ixora/profiles/<id>.yaml`. Flip Full ↔ Custom with `ixora stack config edit <id>`, or use `ixora stack agents <id>` for an agent-only picker.
- **Runtime commands ignore `--profile`.** That flag is install/start-time only. Don't pass it to `ixora agents`, `ixora traces`, etc.
- **Knowledge commands require `--knowledge-id <id>` when multiple KBs exist.** Find IDs via `ixora status -o json | jq '.knowledge.knowledge_instances[] | {id, name}'`. See [references/knowledge-memories.md](references/knowledge-memories.md).
- **`knowledge upload` from a URL uses `--from-url`, NOT `--url`.** The top-level `--url` flag overrides the AgentOS endpoint; using it for an upload silently redirects the entire request to that host.
- **`traces list` has no `--team-id` filter.** Use `--agent-id <member>` to filter by team member, `traces stats --team-id` for rollups, or `traces search --filter '{"team_id":"..."}'` for raw per-trace listing.
- **`traces stats` does NOT accept `--group-by`.** That flag lives on `traces search` only.
- **`sessions delete-all` and `memories delete-all` are batch-by-ID, not filter-based.** Both require `--ids id1,id2,...`; `sessions delete-all` additionally requires a matching `--types` array.
- **`ixora stack agents <id>` only works on managed systems.** External systems are configured at their AgentOS source, not via ixora's component picker.

## Debugging a failed run

The non-obvious path from "something broke" to "I see why":

```bash
ixora status                                          # AgentOS overview
ixora traces list --limit 5                           # newest traces
ixora traces list --status ERROR --limit 20           # filter to failures across all components
ixora traces list --agent-id <member_id> --limit 20   # filter to one team member's traces
ixora traces get <trace_id>                           # span tree + attributes
ixora sessions runs <session_id>                      # every run in the session
ixora stack logs api-default                          # container-level last resort (service = api-<system_id>)
```

See [references/traces-sessions.md](references/traces-sessions.md) for the full pattern including span-tree interpretation.

## Where state lives

```
~/.ixora/
├── .env                         # provider keys, SYSTEM_<ID>_*, IXORA_* toggles
├── ixora-systems.yaml           # registered systems (kind, mode, url)
├── docker-compose.yml           # generated; matches current --profile
└── profiles/<id>.yaml           # component picks for `mode: custom`
```
