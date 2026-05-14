# ixora

CLI for managing ixora AI agent deployments on IBM i.

## Install

```sh
npm install -g @ibm/ixora
```

Or run directly with npx:

```sh
npx @ibm/ixora install
```

### Requirements

- Node.js >= 18
- Docker Desktop (or Podman)
- An IBM i system with Db2 for i
- An API key for your chosen model provider (Anthropic, OpenAI, Google, or Ollama for local)

## Quick Start

```sh
ixora install    # Interactive setup (IBM i connection, model provider, profile)
ixora start      # Start services (defaults to --profile full = DB + API + MCP + UI)
ixora stop       # Stop services
```

### Deployment shapes (`--profile`)

| Profile | Containers | Use case |
|---|---|---|
| `full` (default) | DB + API + MCP + Carbon UI | Local development, the bundled web UI |
| `mcp`            | DB + API + MCP             | Backend-only — bring your own UI, or run as a service |
| `cli`            | DB + API (no MCP container) | Agents use the bundled `ibmi` CLI directly — no MCP server in the path |

```sh
ixora start --profile full  # All four services (default)
ixora start --profile mcp   # No Carbon UI; API on :18000, DB on :15432
ixora start --profile cli   # No MCP container; API runs in CLI mode
```

The chosen profile is persisted to `~/.ixora/.env`, so subsequent `stop`/`status`/`logs`/`restart`/`upgrade` calls without `--profile` keep the same shape. Switching mid-session is safe: `ixora stop --profile mcp` while in `full` leaves the UI container untouched.

The old `--profile api` is accepted as an alias for `--profile mcp` (with a one-line warning).

`--profile cli` sets `IXORA_CLI_MODE=true` on the API container — each API reaches its IBM i system using the stored `SYSTEM_<ID>_*` credentials. You can also set `IXORA_CLI_MODE=true` manually (`ixora config set IXORA_CLI_MODE true && ixora restart`) to run CLI mode under the `full` profile (keeping the UI). See [IXORA_QUICKSTART.md](IXORA_QUICKSTART.md) → §4 "Advanced: CLI mode" / §8 "Stack profiles". PASE stays unavailable in CLI mode.

### Per-system database isolation

By default each IBM i system gets its **own** `ai_<id>` Postgres database (and its own `/data` volume) inside the shared `agentos-db` container — so sessions, memory, knowledge, and learnings are isolated per system. A single-system deployment is just `agentos-db` with an `ai_default` database (nothing extra); with 2+ systems a one-shot `db-init` service provisions the additional databases. To put everything back in one shared `ai` database instead: `ixora config set IXORA_DB_ISOLATION shared && ixora restart`. See [IXORA_QUICKSTART.md](IXORA_QUICKSTART.md) → §4 "Advanced: per-system database isolation".

## Commands

| Command | Description |
|---------|-------------|
| `install` | First-time setup (interactive) |
| `start` | Start services |
| `stop` | Stop services |
| `restart [service]` | Restart all or a specific service |
| `status` | Show service status and deployed profile |
| `upgrade` | Pull latest images and restart |
| `uninstall` | Stop services and remove images |
| `logs [service]` | Tail service logs |
| `version` | Show CLI and image versions |
| `config show` | Show current configuration |
| `config set <key> <value>` | Update a config value |
| `config edit` | Open config in your editor |
| `system add` | Add an IBM i system |
| `system remove` | Remove a system |
| `system list` | List configured systems |

## Options

```
--profile <name>       Stack shape: full (DB + API + MCP + UI) or api (DB + API + MCP, no UI) [default: full]
--agent-profile <name> Agent profile (full|sql-services|security|knowledge), used at install time
--image-version <tag>  Pin image version (e.g., v1.2.0)
--no-pull              Skip pulling images
--purge                Remove volumes too (with uninstall)
--runtime <name>       Force docker or podman
```

`--profile` and `--agent-profile` are independent axes:

- **`--profile`** controls _which containers_ run (stack shape).
- **`--agent-profile`** controls _which agents_ the API loads inside those containers.

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

This installs the shell script to `~/.local/bin/ixora`. The Node.js CLI above is the recommended version going forward.
