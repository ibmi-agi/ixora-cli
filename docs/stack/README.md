# Stack Commands

`ixora stack <cmd>` — manage the local ixora deployment: install containers, manage systems, edit configuration. The runtime commands (`ixora agents`, `ixora traces`, etc.) talk to whatever the stack puts up.

---

## Pages

- [Install](install.md) — `ixora stack install` walkthrough
- [Lifecycle](lifecycle.md) — `start`, `stop`, `restart`, `status`, `logs`, `upgrade`, `uninstall`, `version`
- [Systems](systems.md) — `stack system add | remove | list | default | start | stop | restart`
- [Profiles & deployment shapes](profiles.md) — `--profile full|mcp|cli`, agent profiles, CLI mode, DB isolation
- [Configuration](config.md) — `stack config show | set | edit | reset | show-system`, `stack agents`, `stack components`
- [Model provider](models.md) — `stack models show | set`

---

## At a glance

| Command | What it does |
|---|---|
| `ixora stack install` | First-time interactive setup |
| `ixora stack start [service]` | Start everything (or a specific service) |
| `ixora stack stop [service]` | Stop everything (or one) |
| `ixora stack restart [service]` | Restart |
| `ixora stack status` | Service health + active profile |
| `ixora stack logs [service]` | Tail logs (`-f` style) |
| `ixora stack upgrade [version]` | Pull latest images and restart |
| `ixora stack uninstall` | Stop services, remove images (add `--purge` to wipe volumes) |
| `ixora stack version` | CLI version + image version |
| `ixora stack config show \| set \| edit \| reset` | View / mutate `~/.ixora/.env` and per-system profiles |
| `ixora stack system add \| remove \| list \| default` | Manage IBM i system targets |
| `ixora stack system start \| stop \| restart <id>` | Per-system lifecycle |
| `ixora stack agents [system]` | Edit which agents are enabled on a system |
| `ixora stack components list` | Discover agents/teams/workflows in the deployed image |
| `ixora stack models show \| set` | View / switch model provider |

---

## Global flags relevant to stack commands

| Flag | Effect |
|---|---|
| `--profile <name>` | Pick the stack shape (`full` / `mcp` / `cli`). Persisted as `IXORA_PROFILE` in `.env`. |
| `--mode <name>` | Per-system deployment mode at install (`full` or `custom`). |
| `--image-version <tag>` | Pin a specific image version. |
| `--no-pull` | Skip `docker pull`. |
| `--purge` | With `uninstall`: also delete volumes. **Destructive.** |
| `--runtime <name>` | Force `docker` or `podman`. |

See [`../global-options.md`](../global-options.md) for the complete list.

---

## File mental model

```
~/.ixora/
  .env                   ← edit with: ixora stack config edit / set
  ixora-systems.yaml     ← managed by: ixora stack system add | remove
  docker-compose.yml     ← auto-generated on every start; do not edit
  profiles/<id>.yaml     ← custom component picks per system
  user_tools/            ← custom tool definitions mounted into api-<id>
```

See [`../configuration.md`](../configuration.md) for full details.
