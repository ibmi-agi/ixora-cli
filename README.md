# ixora

CLI for managing ixora AI agent deployments on IBM i.

## Install

```sh
curl -LsSf https://raw.githubusercontent.com/ibmi-agi/ixora-cli/main/install.sh | sh
```

This installs the `ixora` command to `~/.local/bin`.

## Quick Start

```sh
ixora install    # Interactive setup (IBM i connection, model provider, profile)
ixora start      # Start services
ixora stop       # Stop services
```

## Commands

| Command | Description |
|---------|-------------|
| `install` | First-time setup |
| `start` | Start services |
| `stop` | Stop services |
| `restart` | Restart all or a specific service |
| `status` | Show service status and profile |
| `upgrade` | Pull latest images and restart |
| `config` | View and edit configuration |
| `logs` | Tail service logs |
| `uninstall` | Remove services and images |
| `version` | Show versions |

## Options

```
--profile <name>   Agent profile (full|sql-services|security|knowledge)
--version <tag>    Pin image version
--no-pull          Skip pulling images
--purge            Remove volumes too (with uninstall)
--runtime <name>   Force docker or podman
```

## Requirements

- Docker Desktop (or Podman)
- An IBM i system with Db2 for i
- An API key for your chosen model provider (Anthropic, OpenAI, Google, or Ollama for local)
