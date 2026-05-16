---
name: use-ixora
description: >
  Operate the Ixora platform via the `ixora` CLI: install/start/stop the local
  stack, manage one or more IBM i systems (managed or external), configure the
  model provider, run agents/teams/workflows, debug via traces and sessions,
  query the knowledge base and memories, schedule recurring runs, and inspect
  the raw AgentOS HTTP API. Use this skill whenever the user mentions ixora,
  Ixora, AgentOS, the ixora stack, an agent/team/workflow run, a trace, a
  session, a memory, the knowledge base, or anything else routed through an
  ixora system — even in passing.
allowed-tools: Bash(ixora:*), Bash(which:*), Bash(command:*), Bash(docker:*), Bash(podman:*), Bash(curl:*), Bash(cat:*), Bash(ls:*), Bash(grep:*), Bash(tail:*), Bash(jq:*)
---

# use-ixora

The `ixora` CLI exposes **two command trees** with different targeting:

| Tree | Lives at | Talks to | Honors `--system` / `--url`? |
|---|---|---|---|
| **Stack** | `ixora stack <cmd>` | local docker/podman compose deployment under `~/.ixora/` | no — always local |
| **Runtime** | `ixora <group> <cmd>` (top-level: `agents`, `teams`, `workflows`, `traces`, `sessions`, `memories`, `knowledge`, `schedules`, `evals`, `approvals`, `metrics`, `components`, `models`, `databases`, `registries`, `status`, `health`, `docs`) | a running AgentOS resolved from `~/.ixora/ixora-systems.yaml` | yes |

Runtime verbs are **plural** (`ixora agents list`, not `ixora agent list`). CRUD verbs are `create`/`update`/`delete` (never `add`/`edit`/`remove`).

## Ground-truth docs

The repo's `docs/` tree is mirrored into this skill as [`docs/`](docs/) (symlinked at install). It is the **authoritative flag reference** — every command, every flag, every output column. Use it whenever the exact flag set matters, instead of guessing or running `--help` in a loop.

| You need | Read |
|---|---|
| Install walkthrough | [`docs/getting-started.md`](docs/getting-started.md), [`docs/stack/install.md`](docs/stack/install.md) |
| Where state lives | [`docs/configuration.md`](docs/configuration.md) |
| Every top-level flag (`--system`, `--url`, `--json`, `-o`, `--profile`, …) | [`docs/global-options.md`](docs/global-options.md) |
| Output formats and scripting patterns | [`docs/output-formats.md`](docs/output-formats.md) |
| Error → fix recipes | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| One specific command | [`docs/stack/*.md`](docs/stack/) and [`docs/runtime/*.md`](docs/runtime/) |

The `references/` files in this skill cover **workflows, gotchas, and patterns the docs don't transcribe** — load them when the routing table below says to.

## Preflight

Before any non-trivial action, verify the environment:

```bash
command -v ixora                                  # CLI installed?
ixora --cli-version                               # CLI version
ixora stack status                                # is a stack actually running?
ixora stack system list                           # what systems are registered?
```

If the CLI is missing, install with `npm install -g @ibm/ixora` (Node ≥ 20 required). If `stack status` shows no services running, the runtime commands have no AgentOS to talk to — run `ixora stack install` (first time) or `ixora stack start` (existing install). See [`docs/stack/install.md`](docs/stack/install.md) and [`docs/troubleshooting.md`](docs/troubleshooting.md).

## System resolution (the part `--help` won't tell you)

Every `ixora <runtime>` invocation needs a target. The order:

| Inputs | Outcome |
|---|---|
| `--url <url>` supplied | Skip resolution entirely; hit that URL. |
| `--system <id>` supplied | Always wins over the default. |
| 1 system available | Implicit pick — no flag needed. |
| 2+ available, default set | Use the default (`ixora stack system default <id>`). |
| 2+ available, no default | **Error** — `--system <id>` (or `IXORA_DEFAULT_SYSTEM`) required. |

"Available" = managed systems with running containers **plus all external systems** (externals are always considered available — no docker check). `ixora stack system list` shows the set; the default is marked `*`.

Full rules: [`docs/global-options.md`](docs/global-options.md) (see "AgentOS targeting flags") and [`docs/runtime/README.md`](docs/runtime/README.md) (see "Targeting a system").

## The three "profile" concepts (deconflict before reading further)

`ixora` uses the word "profile" for three different things. The distinction matters:

| Concept | Controls | Set by | Values |
|---|---|---|---|
| **Stack profile** | Which *containers* run | `--profile` flag, `IXORA_PROFILE` in `.env` | `full` / `mcp` / `cli` |
| **Agent profile** | Which *agents* a system loads inside its API container | Install prompt; `profile:` field in `ixora-systems.yaml` | `full` / `sql-services` / `security` / `knowledge` |
| **Deployment mode** | Whether a system uses the agent profile or hand-picked components | `ixora stack config edit <id>`, `--mode` at install | `full` / `custom` |

When the user says "set the profile to security," they probably mean **agent profile** (which agents load). When they say "switch to CLI profile," they mean **stack profile** (which containers run). Treat ambiguous mentions as agent profile by default and confirm.

See [`references/profiles.md`](references/profiles.md) and [`docs/stack/profiles.md`](docs/stack/profiles.md) for the full breakdown.

## Common quick operations

These are frequent enough to run without loading a reference:

```bash
# Stack
ixora stack status                                # services + profile + image
ixora stack start                                 # honor persisted profile
ixora stack restart                               # after config changes
ixora stack logs api-default                      # tail one service
ixora stack system list                           # show systems (default marked *)
ixora stack config show                           # active config table
ixora stack config set <KEY> <VALUE>              # then ixora stack restart

# Runtime (targets the resolved system; add --system <id> to override)
ixora status                                      # AgentOS overview (agents, KBs, dbs)
ixora health                                      # uptime + latency; exits 1 if unhealthy
ixora agents list                                 # registered agents
ixora agents run <id> "<message>" --stream        # one-shot or streamed
ixora traces list --limit 5                       # newest traces
ixora traces list --status error                  # only failures
ixora sessions runs <session_id>                  # all runs in a session
ixora knowledge search "<query>"                  # vector search
ixora docs list --tag <Tag>                       # discover raw API endpoints
```

For exact flags on any of these, read the matching page in `docs/runtime/` or `docs/stack/`.

## References — load when relevant

`references/` covers workflows and gotchas that the docs don't. Each reference also links into `docs/` for the canonical flag surface. Load only the references the task needs; one is usually enough.

| Surface / intent | Read |
|---|---|
| Install, start/stop, restart, logs, upgrade, uninstall | [`references/stack-lifecycle.md`](references/stack-lifecycle.md) |
| Multi-system: add/remove/start/stop, managed vs external, env var naming | [`references/systems.md`](references/systems.md) |
| Disambiguate stack profile / agent profile / deployment mode, switch between them | [`references/profiles.md`](references/profiles.md) |
| Agents / teams / workflows: `run`, `continue` (HITL), `resume` (SSE), `cancel`, `--confirm` cache | [`references/agents-teams-workflows.md`](references/agents-teams-workflows.md) |
| Debug a failed run: traces, sessions, span trees, sessions-vs-traces decision table | [`references/traces-sessions.md`](references/traces-sessions.md) |
| Upload, search, multi-KB rules, the `--from-url` vs `--url` trap | [`references/knowledge.md`](references/knowledge.md) |
| Long-lived user memories: CRUD, topics, stats, optimize | [`references/memories.md`](references/memories.md) |
| Cron-triggered AgentOS calls: create, pause/resume, trigger, run history | [`references/schedules.md`](references/schedules.md) |
| Eval runs: `accuracy`, `agent_as_judge`, `reliability`, `performance` | [`references/evals.md`](references/evals.md) |
| Raw HTTP API discovery — use `ixora docs` before writing curl | [`references/docs.md`](references/docs.md) |
| Status, health, metrics, approvals, components, models, registries | [`references/observability.md`](references/observability.md) |

For anything else, `ixora <group> --help` and `ixora <group> <verb> --help` are exhaustive.

## Local deployment shape

- **Prereqs:** Node ≥ 20 and a running Docker (or Podman) daemon.
- **Default ports** for the first managed system: API `18000`, DB `15432`, UI `13000`. Each additional managed system shifts the API port by `+1` (system index 1 → `18001`, index 2 → `18002`, …). DB and UI ports are shared.
- **Service names** (pass to `stack logs|restart|stop|start <service>`):
  - `agentos-db` — shared Postgres (per-system DBs live inside this single container)
  - `db-init` — one-shot DB provisioner; only present with 2+ per-system isolated DBs
  - `api-<system_id>` — AgentOS API per managed system (e.g. `api-default`, `api-prod`)
  - `mcp-<system_id>` — MCP server per managed system (omitted under `--profile cli`)
  - `ui` — Carbon UI (only under `--profile full`)
- Run `ixora stack status` for the live list. The `SERVICE` column is canonical; the CLI also accepts compose container names (`ixora-api-default-1`) but prefer the SERVICE form in scripts.
- **Runtime override:** auto-detection tries `docker compose` then `podman compose` then legacy `docker-compose`. Force one with `--runtime docker` / `--runtime podman` on any `stack` command.

Full container architecture matrix: [`docs/configuration.md`](docs/configuration.md) (see "Container architecture").

## Where state lives

```
~/.ixora/
├── .env                         # provider keys, SYSTEM_<ID>_*, IXORA_* toggles (mode 0600)
├── ixora-systems.yaml           # registered systems (kind, mode, url, profile, agents)
├── docker-compose.yml           # generated on every start; do not edit
├── profiles/<id>.yaml           # component picks for systems in mode: custom
└── user_tools/                  # custom tool definitions mounted into api-<id>
```

Edit `.env` via `ixora stack config set <key> <value>` or `ixora stack config edit`. Edit `ixora-systems.yaml` via `ixora stack system add|remove|default`. Both files survive `uninstall`; `uninstall --purge` only wipes the Postgres volume.

See [`docs/configuration.md`](docs/configuration.md) for full file formats.

## Gotchas

- **`ixora stack start <external-id>` errors out.** Externals have no local lifecycle — they're URLs that runtime commands route to. Only managed systems respond to `system start|stop|restart`.
- **System ID → env var name**: hyphens become underscores, all uppercased. `my-system` → `SYSTEM_MY_SYSTEM_HOST`, `SYSTEM_MY_SYSTEM_AGENTOS_KEY`. Always write via `ixora stack config set <key> <value>` (never hand-edit `.env`).
- **`--profile cli` skips the MCP container.** Sets `IXORA_CLI_MODE=true`; agents reach IBM i via the bundled `ibmi` CLI in `api-<id>` using stored `SYSTEM_<ID>_*` creds. PASE is unavailable.
- **Stack profile is sticky.** Once set by `stack start --profile <name>`, subsequent `stop|status|logs|restart|upgrade` calls without `--profile` keep the same shape. Pass `--profile` again to switch.
- **Per-system DB isolation is the default.** Each system gets its own `ai_<id>` Postgres database inside the shared `agentos-db` container. Consolidate with `ixora stack config set IXORA_DB_ISOLATION shared && ixora stack restart`. Switching modes does not move existing data.
- **Custom component profiles only apply when `mode: custom`.** They live in `~/.ixora/profiles/<id>.yaml`. Flip Full ↔ Custom with `ixora stack config edit <id>`, or use `ixora stack agents <id>` for an agent-only picker.
- **Runtime commands ignore `--profile`.** That flag is install/start-time only. Don't pass it to `ixora agents`, `ixora traces`, etc.
- **`ixora --cli-version` (not `--version`)** reports the CLI version. `ixora stack version` reports CLI + image versions side-by-side.
- **Knowledge commands require `--knowledge-id <id>` when multiple KBs exist.** Find IDs via `ixora status -o json | jq '.knowledge.knowledge_instances[] | {id, name}'`. See [`references/knowledge.md`](references/knowledge.md).
- **`knowledge upload` from a URL uses `--from-url`, NOT `--url`.** The top-level `--url` flag overrides the AgentOS endpoint; using it for an upload silently redirects the entire request to that host.
- **`traces list` has no `--team-id` filter.** Use `--agent-id <member>` to filter by team member, `traces stats --team-id` for rollups, or `traces search --filter '{"team_id":"..."}'` for raw per-trace listing.
- **`traces stats` does NOT accept `--group-by`.** That flag lives on `traces search` only.
- **`sessions delete-all` and `memories delete-all` are batch-by-ID, not filter-based.** Both require `--ids id1,id2,...`; `sessions delete-all` additionally requires a matching `--types` array.
- **`ixora stack agents <id>` only works on managed systems.** External systems are configured at their AgentOS source, not via ixora's component picker.
- **`agents continue --confirm/--reject` reads a local 24h cache** at `~/.ixora/agentos-paused-runs/<run_id>.json`. If the cache expired or this machine never saw the pause, pass tool-results JSON explicitly. The cache is **merged on every re-pause** so consecutive `--confirm`s preserve `session_id` automatically. See [`references/agents-teams-workflows.md`](references/agents-teams-workflows.md).
- **`agents run --stream` exits 4 on `RunPaused`** (otherwise 0 = completed, 2 = stream error). Branch on `$?` instead of grepping the log.
- **`ixora agents pending`** lists local paused runs (run_id, agent, age, pending tools); `agents pending <run_id>` pretty-prints the pending tool calls plus the original prompt. Use it to discover what's queued before approving.
- **`agents continue` can be called with just `<run_id>`** — agent_id is read from the cache. The legacy `<agent_id> <run_id>` form still works.
- **`agents run --interactive --stream`** drops you into an inline approve / reject / show-details / quit prompt on each pause and continues the same stream — no second invocation, no `--session-id` hunting.

## Debugging a failed run

The non-obvious path from "something broke" to "I see why":

```bash
ixora status                                          # AgentOS overview
ixora health                                          # uptime + latency; non-zero exit if unhealthy
ixora traces list --limit 5                           # newest traces
ixora traces list --status error --limit 20           # filter to failures across all components
ixora traces list --agent-id <member_id> --limit 20   # filter to one team member's traces
ixora traces get <trace_id>                           # span tree + attributes
ixora sessions runs <session_id>                      # every run in the session
ixora stack logs api-default                          # container-level last resort (service = api-<system_id>)
```

Full pattern (incl. span-tree interpretation): [`references/traces-sessions.md`](references/traces-sessions.md).

## Execution rules

1. Prefer `ixora` over raw `docker compose` / `curl`. The CLI is built for this.
2. Use `--json` (optionally with field projection: `--json id,name`) for reliable parsing.
3. Resolve the target system before mutating it. Know which system you're acting on.
4. For destructive actions (`uninstall --purge`, `knowledge delete-all`, `sessions delete`, `memories delete-all`), confirm intent and state impact before executing.
5. After mutations, verify with a read-back (`stack status`, `traces list --limit 1`, `knowledge status <id>`).
