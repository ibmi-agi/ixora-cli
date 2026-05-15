# ixora

CLI for managing ixora AI agent deployments on IBM i — and for talking to the running AgentOS.

## Install

```sh
npm install -g @ibm/ixora
```

Or run directly with npx:

```sh
npx @ibm/ixora stack install
```

### Requirements

- Node.js >= 20
- Docker Desktop (or Podman)
- An IBM i system with Db2 for i
- An API key for your chosen model provider (Anthropic, OpenAI, Google, or Ollama for local)

## Quick Start

```sh
ixora stack install    # Interactive setup (IBM i connection, model provider, profile)
ixora stack start      # Start services (defaults to --profile full = DB + API + MCP + UI)
ixora stack stop       # Stop services
```

Once a system is up, talk to AgentOS directly:

```sh
ixora agents list      # List registered agents
ixora agents run <id> "what's running on QSYS?"
ixora traces list      # See recent runs
ixora sessions list    # Browse sessions
ixora knowledge search "..."
```

If only one system is available, those commands target it implicitly. With 2+ systems available you have two options:

```sh
ixora --system prod agents list           # one-off override
ixora stack system default prod           # set a persistent default
ixora agents list                         # now uses 'prod' implicitly
ixora --system dev agents list            # flag still wins over the default
ixora stack system default --clear        # back to "must specify --system"
```

### External AgentOS endpoints

Beyond the IBM i stacks ixora provisions ("managed" systems), you can register **any AgentOS-compatible URL** as a target — typically another locally-running AgentOS instance you spun up from a different template, but the URL can be remote too. ixora doesn't lifecycle-manage these ("external" systems); it just routes runtime commands at them.

```sh
ixora stack system add                                     # interactive — pick "External"
ixora stack system add --kind external --id personal \
  --url http://localhost:8080 [--key sk-xxx]               # non-interactive

ixora stack system list                                    # shows KIND + URL columns
ixora --system personal agents list                        # target the external by name
ixora stack start personal                                 # ERRORS — externals have no local lifecycle
```

Externals always count as "available" (no docker container check), so the implicit-pick rule extends naturally: 1 available → pick it; 2+ → require `--system` (or `IXORA_DEFAULT_SYSTEM`). The optional `--key` is stored as `SYSTEM_<ID>_AGENTOS_KEY` in `~/.ixora/.env`.

## Two command surfaces

The `ixora` binary exposes two trees:

| Tree | Purpose | Examples |
|---|---|---|
| `ixora stack ...` | Manage the local stack: install, start/stop, configure, add IBM i systems | `ixora stack install`, `ixora stack system add`, `ixora stack config set ...` |
| `ixora <runtime> ...` | Talk to the running AgentOS (ported from the standalone `agno-cli`) | `ixora agents`, `ixora teams`, `ixora workflows`, `ixora traces`, `ixora sessions`, `ixora knowledge`, `ixora memories`, `ixora evals`, `ixora approvals`, `ixora schedules`, `ixora metrics`, `ixora databases`, `ixora registries`, `ixora components`, `ixora models`, `ixora status` |

`ixora <runtime>` commands always pick a target system (the only running one by default; `--system <name>` to choose). `ixora stack` commands are unaffected by `--system` — they have their own targeting (`ixora stack system start <id>`, etc.).

### Deployment shapes (`--profile`)

| Profile | Containers | Use case |
|---|---|---|
| `full` (default) | DB + API + MCP + Carbon UI | Local development, the bundled web UI |
| `mcp`            | DB + API + MCP             | Backend-only — bring your own UI, or run as a service |
| `cli`            | DB + API (no MCP container) | Agents use the bundled `ibmi` CLI directly — no MCP server in the path |

```sh
ixora stack start --profile full  # All four services (default)
ixora stack start --profile mcp   # No Carbon UI; API on :18000, DB on :15432
ixora stack start --profile cli   # No MCP container; API runs in CLI mode
```

The chosen profile is persisted to `~/.ixora/.env`, so subsequent `stop`/`status`/`logs`/`restart`/`upgrade` calls without `--profile` keep the same shape. Switching mid-session is safe: `ixora stack stop --profile mcp` while in `full` leaves the UI container untouched.

The old `--profile api` is accepted as an alias for `--profile mcp` (with a one-line warning).

`--profile cli` sets `IXORA_CLI_MODE=true` on the API container — each API reaches its IBM i system using the stored `SYSTEM_<ID>_*` credentials. You can also set `IXORA_CLI_MODE=true` manually (`ixora stack config set IXORA_CLI_MODE true && ixora stack restart`) to run CLI mode under the `full` profile (keeping the UI). See [IXORA_QUICKSTART.md](IXORA_QUICKSTART.md) → §4 "Advanced: CLI mode" / §8 "Stack profiles". PASE stays unavailable in CLI mode.

### Per-system database isolation

By default each IBM i system gets its **own** `ai_<id>` Postgres database (and its own `/data` volume) inside the shared `agentos-db` container — so sessions, memory, knowledge, and learnings are isolated per system. A single-system deployment is just `agentos-db` with an `ai_default` database (nothing extra); with 2+ systems a one-shot `db-init` service provisions the additional databases. To put everything back in one shared `ai` database instead: `ixora stack config set IXORA_DB_ISOLATION shared && ixora stack restart`. See [IXORA_QUICKSTART.md](IXORA_QUICKSTART.md) → §4 "Advanced: per-system database isolation".

## Stack commands

| Command | Description |
|---------|-------------|
| `stack install` | First-time setup (interactive) |
| `stack start` | Start services |
| `stack stop` | Stop services |
| `stack restart [service]` | Restart all or a specific service |
| `stack status` | Show service status and deployed profile |
| `stack upgrade` | Pull latest images and restart |
| `stack uninstall` | Stop services and remove images |
| `stack logs [service]` | Tail service logs |
| `stack version` | Show CLI and image versions |
| `stack config show` | Show current configuration |
| `stack config set <key> <value>` | Update a config value |
| `stack config edit` | Open config in your editor |
| `stack system add` | Add a system: **managed** (provision a new ixora IBM i stack) or **external** (register an existing AgentOS URL — local or remote). Flags: `--kind managed\|external --id ... --name ... --url ... --key ...` |
| `stack system remove <id>` | Remove a system (works for both kinds; cleans up env keys) |
| `stack system list` | List configured systems with KIND + URL columns (default marked with `*`) |
| `stack system start\|stop\|restart <id>` | Manage one managed system's containers (errors with a hint if `<id>` is external) |
| `stack system default [id] [--clear]` | Show, set, or clear the default system used when 2+ are available and `--system` is omitted |
| `stack components list` | Inspect components in the deployed image |
| `stack models show\|set` | View / switch model provider |
| `stack agents [system]` | Edit which agents are enabled on a system (component picker) |

## AgentOS runtime commands

| Command | Description |
|---------|-------------|
| `agents list\|get\|run\|continue\|cancel` | Manage agents |
| `teams list\|get\|run\|continue\|cancel` | Manage teams |
| `workflows list\|get\|run\|continue\|cancel` | Manage workflows |
| `traces list\|get\|stats\|search` | Inspect traces |
| `sessions list\|get\|create\|update\|delete\|delete-all\|runs` | Manage sessions |
| `memories list\|get\|create\|update\|delete\|delete-all\|topics\|stats\|optimize` | Manage memories |
| `knowledge upload\|list\|get\|search\|status\|delete\|delete-all\|config` | Manage knowledge base |
| `evals list\|get\|delete` | Manage eval runs |
| `approvals list\|get\|resolve` | Manage approvals |
| `schedules list\|get\|create\|update\|delete\|pause\|resume\|runs` | Manage schedules |
| `metrics get\|refresh` | View / refresh metrics |
| `databases migrate <db_id>` | Run database migrations |
| `registries list` | List registry items |
| `components list\|get\|create\|update\|delete\|config ...` | Manage components in AgentOS |
| `models list` | List available models in AgentOS |
| `status` | Show AgentOS server status and resource overview |
| `health` | Ping `/health` on the resolved system; reports status + uptime + latency (exits non-zero when unhealthy) |

## Global options

```
# Stack shape & install-time
--profile <name>       Stack shape: full / mcp / cli  [default: full]
--mode <name>          Per-system mode: full / custom (install-time)
--image-version <tag>  Pin image version (e.g., v1.2.0)
--no-pull              Skip pulling images
--purge                Remove volumes too (with uninstall)
--runtime <name>       Force docker or podman

# AgentOS targeting (consumed by ixora <runtime> ... commands)
-s, --system <name>    Target a specific configured system. Implicit when only one is
                       running, or when the configured default (ixora stack system default)
                       is in the running set. Always wins when supplied.
--url <url>            Override AgentOS endpoint entirely (skips system resolution)
--key <key>            Override AgentOS API key for this invocation
--timeout <seconds>    Override request timeout in seconds
--no-color             Disable color output
--json [fields]        Emit JSON; `--json id,name` projects fields
-o, --output <format>  Output format: json or table (auto-detects from TTY)
```

## Use with Claude Code (skill)

This repo doubles as a [Claude Code plugin marketplace](https://docs.anthropic.com/en/docs/claude-code/plugins) exposing the `use-ixora` skill, which teaches Claude how to drive the Ixora platform with this CLI — installing the stack, managing multiple systems (managed and external), running agents, inspecting traces, browsing knowledge, and more.

**Via the Claude Code marketplace:**

```sh
claude plugin marketplace add ibmi-agi/ixora-cli
claude plugin install use-ixora@ixora-cli
```

**Via `npx skills`:**

```sh
npx skills add ibmi-agi/ixora-cli
```

Once installed, Claude activates the skill automatically based on context — e.g. "install ixora", "add a new ixora system", "run an agent on prod", "inspect that trace" — or you can invoke it explicitly as `/ixora-cli:use-ixora`.

## Development

```sh
git clone https://github.com/ibmi-agi/ixora-cli.git
cd ixora-cli
npm install
npm run build
npm link          # Makes 'ixora' available globally

npm test          # Run tests
npm run dev -- <command>  # Run without building
```

---

## Legacy: Shell Script Version

The original `ixora.sh` shell script is still available in this repo for reference. To install it directly:

```sh
curl -LsSf https://raw.githubusercontent.com/ibmi-agi/ixora-cli/main/install.sh | sh
```

This installs the shell script to `~/.local/bin/ixora`. The Node.js CLI above is the recommended version going forward. (The shell script does not include the AgentOS runtime commands — only the stack-management surface.)
