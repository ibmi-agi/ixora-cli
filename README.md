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
ixora start      # Start services
ixora stop       # Stop services
```

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
--profile <name>       Agent profile (full|sql-services|security|knowledge)
--image-version <tag>  Pin image version (e.g., v1.2.0)
--no-pull              Skip pulling images
--purge                Remove volumes too (with uninstall)
--runtime <name>       Force docker or podman
```

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
