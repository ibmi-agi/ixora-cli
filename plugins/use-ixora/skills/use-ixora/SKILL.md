---
name: use-ixora
description: Operate the Ixora platform via the `ixora` CLI. Use when the user asks to install / start / stop / restart / upgrade the ixora stack, add or remove an ixora system (managed compose stack OR external AgentOS URL), configure the model provider, switch between systems via `--system`, list or run ixora agents / teams / workflows, inspect traces or sessions on a running system, search the knowledge base, manage memories, check system health, edit per-system component profiles (Full vs Custom), tail container logs, or pin/upgrade the deployed image version. Covers the `kind: managed | external` discriminator and per-system `SYSTEM_<ID>_*` env vars in `~/.ixora/.env`.
---

# use-ixora

CLI skill for the **Ixora** platform on IBM i. The single `ixora` binary exposes two command trees:

| Tree | Purpose |
|---|---|
| `ixora stack <cmd>` | Local stack lifecycle: install, start/stop, multi-system management, config, model provider, components, logs |
| `ixora <runtime> <cmd>` | Talk to a running AgentOS: `agents`, `teams`, `workflows`, `traces`, `sessions`, `memories`, `knowledge`, `evals`, `approvals`, `schedules`, `metrics`, `databases`, `registries`, `components`, `models`, `status`, `health` |

`ixora stack` commands have their own targeting (positional `<id>` args). `ixora <runtime>` commands resolve a target system from `~/.ixora/ixora-systems.yaml` — see **System resolution** below.

## When to use this skill

Use `use-ixora` when the user wants to install, configure, or operate an Ixora deployment, or run / inspect anything against a running AgentOS that ixora manages. Examples:

- "install ixora", "start the stack", "tail the API logs"
- "add a new system", "register an external AgentOS", "switch to OpenAI"
- "list agents on prod", "run the dash-toystore team", "inspect that trace"
- "what knowledge is loaded", "search the KB for revenue patterns"

**Escape hatches:** for direct docker / compose work, drop to `docker compose -f ~/.ixora/docker-compose.yml ...`. For programmatic AgentOS access beyond what the CLI exposes, hit the HTTP API directly or use the `@worksofadam/agentos-sdk` package.

## First-time setup

```bash
npm install -g @ibm/ixora        # node >= 20 required
ixora stack install              # interactive: runtime, model provider, IBM i creds, profile
ixora stack start                # default profile: full (DB + API + MCP + UI)
ixora stack status               # verify services are up
```

The installer prompts for: container runtime (docker / podman, auto-detected), model provider (anthropic / openai / google / ollama / custom), IBM i connection (host / port / user / password), and optionally the deployment mode (Full = every component; Custom = pick which agents/teams/etc to load).

State lands in `~/.ixora/`:
- `.env` — shell-sourced env vars (provider keys, `SYSTEM_<ID>_*` creds, `IXORA_*` toggles)
- `ixora-systems.yaml` — registered systems (`kind: managed | external`, mode, name)
- `docker-compose.yml` — generated compose file matching the current profile
- `profiles/<id>.yaml` — per-system component lists (only when `mode: custom`)

## System resolution

Every `ixora <runtime> ...` invocation needs a target. The resolution order:

| Inputs | Result |
|---|---|
| `--url <url>` supplied | Skip resolution. Hit that URL directly. |
| 1 system available | Implicit pick — no flag needed. |
| 2+ available, default set (`ixora stack system default <id>`) | Use the default. |
| 2+ available, no default | Error — `--system <id>` required. |
| `--system <id>` supplied | Always wins, overrides everything else. |

"Available" means: managed systems whose containers are running, **plus all external systems** (externals are always considered available — no docker check). `ixora stack system list` shows the set with KIND + URL columns, default marked `*`.

## Common workflows

### 1. Fresh install + first agent run

```bash
ixora stack install
ixora stack start
ixora agents list --json id,name        # discover what's loaded
ixora agents run ibmi-system-health "Full system health check"
```

### 2. Add a second system

**Managed** (provisions a new ixora-managed IBM i stack):

```bash
ixora stack system add --kind managed --id dev --name "Development"
ixora stack system start dev
ixora --system dev agents list
```

**External** (register an existing AgentOS URL — local or remote, no lifecycle management):

```bash
ixora stack system add --kind external --id personal \
  --url http://localhost:8080 [--key sk-xxx]
ixora --system personal agents list
# ixora stack start personal   # would ERROR — externals have no local lifecycle
```

### 3. Switch model provider

```bash
ixora stack models show                  # current provider + model
ixora stack models set openai            # interactive: enter the API key
ixora stack restart                      # API needs a restart to pick it up
```

### 4. Debug a failed agent run

```bash
ixora status                                          # AgentOS server overview
ixora traces list --limit 5                           # newest traces
ixora traces list --team-id ibmi-dash-toystore --status ERROR --limit 10
ixora traces get <trace_id>                           # full envelope + span tree
ixora sessions runs <session_id>                      # every run in the session
ixora stack logs agentos-api                          # container logs as a last resort
```

### 5. Upgrade ixora

```bash
ixora stack upgrade                          # latest tag
ixora stack upgrade v1.2.0                   # pin to a specific version
ixora stack upgrade --no-pull                # use already-pulled images
ixora stack uninstall --purge                # nuke volumes too
```

## Subcommand map

| Family | Verbs | Reference |
|---|---|---|
| `stack install\|start\|stop\|restart\|status\|upgrade\|uninstall\|logs\|version` | Stack lifecycle | [references/stack-lifecycle.md](references/stack-lifecycle.md) |
| `stack config show\|set\|edit\|reset\|show-system` | Config + per-system Full/Custom | [references/stack-lifecycle.md](references/stack-lifecycle.md) |
| `stack components\|agents\|models` | Inspect / edit deployed components | [references/stack-lifecycle.md](references/stack-lifecycle.md) |
| `stack system add\|remove\|list\|start\|stop\|restart\|default` | Multi-system + managed/external | [references/systems.md](references/systems.md) |
| `agents\|teams\|workflows list\|get\|run\|continue\|cancel` | Runtime: invoke and manage agents/teams/workflows | [references/agents-teams-workflows.md](references/agents-teams-workflows.md) |
| `traces list\|get\|stats\|search`, `sessions list\|get\|create\|update\|delete\|delete-all\|runs` | Debugging + conversation history | [references/traces-sessions.md](references/traces-sessions.md) |
| `knowledge upload\|list\|get\|search\|status\|delete\|delete-all\|config`, `memories list\|get\|create\|update\|delete\|delete-all\|topics\|stats\|optimize` | KB + long-lived facts | [references/knowledge-memories.md](references/knowledge-memories.md) |
| `evals`, `approvals`, `schedules`, `metrics`, `databases`, `registries`, `components`, `models`, `status`, `health` | Misc runtime ops | See `ixora <cmd> --help` |

Each reference is **load-on-demand**: read it when the user asks about that surface, not preemptively.

## One-line recipes

```bash
ixora --system dev agents list --json id,name          # JSON projection, target dev
ixora traces list --limit 20 --json trace_id,status,duration,input
ixora traces stats --team-id ibmi-dash-toystore        # token + duration rollup
ixora knowledge search --knowledge-id $KB --max-results 5 "monthly revenue"
ixora stack system list                                # KIND + URL columns, default marked *
ixora stack status                                     # services + deployed profile
ixora stack logs agentos-mcp                           # tail one service
ixora --runtime podman stack start                     # force podman over docker
```

## Gotchas

- **`ixora stack start <external-id>` errors out.** Externals have no local lifecycle — they're just URLs the runtime commands route to. Only managed systems respond to `system start|stop|restart`.
- **System ID → env var name** transforms hyphens to underscores and uppercases: `my-system` → `SYSTEM_MY_SYSTEM_HOST`, `SYSTEM_MY_SYSTEM_AGENTOS_KEY`, etc. Watch this when manually editing `~/.ixora/.env`.
- **`--profile cli` skips the MCP container.** Sets `IXORA_CLI_MODE=true`; agents fall back to the bundled `ibmi` CLI to reach IBM i directly using the stored `SYSTEM_<ID>_*` creds. PASE is unavailable in CLI mode.
- **Profile is sticky.** Once set via `stack start --profile <name>`, subsequent `stop|status|logs|restart|upgrade` calls without `--profile` keep the same shape. Pass `--profile` again to switch.
- **Per-system DB isolation is the default.** Each system gets its own `ai_<id>` Postgres database inside the shared `agentos-db` container. To consolidate: `ixora stack config set IXORA_DB_ISOLATION shared && ixora stack restart`.
- **Custom component profiles only kick in when `mode: custom`.** Files live in `~/.ixora/profiles/<id>.yaml`. Use `ixora stack config edit <id>` to flip Full ↔ Custom, or `ixora stack agents <id>` for an agent-only picker.
- **The runtime commands ignore `--profile`.** That flag only matters at install / start time. Don't pass it to `ixora agents`, `ixora traces`, etc.
- **Singular vs plural.** All runtime commands are **plural**: `ixora agents`, `ixora traces`, `ixora sessions`, `ixora memories`, `ixora workflows`. (No `ixora agent`.)
- **Memory + session CRUD verbs are `create / update / delete`**, not `add / edit / remove`.
- **`evals` lists/gets/deletes only — it does NOT run evals.** Evals are launched server-side; the CLI is read-only on them.
- **`traces stats` does not accept `--group-by`.** Grouping is on `traces search` only.
- **`--limit` is per subcommand, not global.** Always specify it on `list` commands or output can be huge.

## Config & path reference

```
~/.ixora/
├── .env                         # shell vars: provider keys, SYSTEM_<ID>_*, IXORA_*
├── ixora-systems.yaml           # registered systems (id, name, kind, mode, url)
├── docker-compose.yml           # generated compose file matching the current profile
└── profiles/
    └── <system-id>.yaml         # component picks for `mode: custom`
```

Global flags (applied at the program level):

```
--profile <name>       full / mcp / cli (default: full)
--mode <name>          full / custom (install-time, per-system)
--image-version <tag>  pin image version (e.g., v1.2.0)
--no-pull              skip pulling images
--purge                remove volumes too (with uninstall)
--runtime <name>       force docker or podman

-s, --system <name>    target a specific configured system
--url <url>            override AgentOS endpoint entirely
--key <key>            override AgentOS API key for this invocation
--timeout <seconds>    override request timeout
--no-color             disable color output
--json [fields]        emit JSON; `--json id,name` projects fields
-o, --output <format>  json | table (auto-detects from TTY)
```
