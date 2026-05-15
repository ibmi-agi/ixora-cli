# Stack lifecycle — `ixora stack`

Local-stack management. All commands live under `ixora stack <cmd>`. None of them respect `--system` / `--url` — they target the local deployment directly. The `agentos-db` / `agentos-api` / `ibmi-mcp-server` / `carbon-ui` containers are spawned via `docker compose` (or `podman compose`) against the generated `~/.ixora/docker-compose.yml`.

## install — first-time setup

```bash
ixora stack install
```

Interactive. Prompt sequence:

1. **Container runtime** — auto-detects `docker compose` v2, then `podman compose`, then legacy `docker-compose` v1. Forceable with `--runtime docker` / `--runtime podman`.
2. **Model provider** — anthropic | openai | google | ollama | openai-compatible | custom. Picks the appropriate env vars and prompts for an API key (skipped for local Ollama).
3. **IBM i connection** — host, port (default `8076`), user, password. Written as `SYSTEM_DEFAULT_*` in `~/.ixora/.env`. A `default` managed system gets registered in `ixora-systems.yaml`.
4. **Deployment mode** — only asked when supported by the image:
   - `Full` — load every component the image declares.
   - `Custom` — opens a component picker; selected IDs land in `~/.ixora/profiles/default.yaml`.

After install, the stack is **not started yet** — run `ixora stack start`.

Re-running `install` against an existing `~/.ixora/.env` keeps prior values as defaults so you can mostly hit enter through prompts.

## start / stop / restart / status

```bash
ixora stack start [service]            # all services, or one
ixora stack stop  [service]
ixora stack restart [service]
ixora stack status                     # service list + deployed profile
```

`start` writes/rewrites `~/.ixora/docker-compose.yml` from the current profile and runs `compose up -d`. With no `--profile`, the previously-persisted value is reused. Subsequent `stop|status|logs|restart|upgrade` calls without `--profile` keep the same shape.

`status` shows: each service's state, container name, port mapping, and the active deployment profile (`full` / `mcp` / `cli`).

### `--profile` (stack shape)

| Profile | Containers | Use case |
|---|---|---|
| `full` (default) | agentos-db, agentos-api, ibmi-mcp-server, carbon-ui | Local dev with the bundled UI |
| `mcp` | agentos-db, agentos-api, ibmi-mcp-server | Backend-only (`--profile api` is accepted as an alias with a deprecation warning) |
| `cli` | agentos-db, agentos-api | API runs in CLI mode (`IXORA_CLI_MODE=true`), no MCP container — agents reach IBM i via the bundled `ibmi` CLI directly. PASE unavailable. |

```bash
ixora stack start --profile mcp     # no UI; API on :18000
ixora stack start --profile cli     # no MCP container; CLI mode
```

To run CLI mode under `full` (CLI mode but keep the UI): `ixora stack config set IXORA_CLI_MODE true && ixora stack restart`.

## upgrade / uninstall / logs / version

```bash
ixora stack upgrade               # latest tag for the configured channel
ixora stack upgrade v1.2.0        # pin specific version
ixora stack upgrade --no-pull     # don't fetch; use already-pulled image
ixora stack uninstall             # stop services + remove images
ixora stack uninstall --purge     # ALSO removes the agentos-db volume — destroys data
ixora stack logs                  # tail all services
ixora stack logs agentos-api      # tail one service
ixora stack version               # CLI + image versions side-by-side
```

`upgrade [version]` accepts bare versions (`0.0.11`) or `v`-prefixed (`v0.0.11`); both normalize internally.

## config — view and edit deployment configuration

```bash
ixora stack config show                            # current ~/.ixora/.env (sensitive keys masked)
ixora stack config set <key> <value>               # programmatic update; preserves comments
ixora stack config edit                            # open .env in $EDITOR
ixora stack config edit <system>                   # Full/Custom picker for that system
ixora stack config reset <system>                  # drop custom profile, revert to Full (.bak created)
ixora stack config show-system <system>            # mode + resolved component list
```

Common config keys (`config set`):

- `IXORA_CLI_MODE` — `true` to run API in CLI mode without flipping profile
- `IXORA_DB_ISOLATION` — `per-system` (default) or `shared`
- `IXORA_IMAGE_VERSION` — pin the image used on next `start`/`upgrade`
- `IXORA_DEFAULT_SYSTEM` — implicit `--system` when 2+ are available

`config edit <system>` is the same plumbing as the agent picker — it switches a system's `mode` field in `ixora-systems.yaml` between `full` and `custom`. `reset <system>` drops a custom profile back to Full (the `.yaml` is backed up to `.yaml.bak`).

## agents — edit which components a system loads

```bash
ixora stack agents              # pick a system interactively
ixora stack agents <system>     # open the picker directly for that system
```

Wraps the same component picker `install --mode custom` uses. Picking implies Custom mode — there's no Full/Custom prompt here. Writes `~/.ixora/profiles/<system>.yaml`. Restart the system after editing for changes to take effect (`ixora stack system restart <id>`).

## components — inspect the deployed image

```bash
ixora stack components list                       # cached manifest
ixora stack components list --refresh             # re-fetch from the installed image
ixora stack components list --image ghcr.io/...   # override the image ref
```

Pretty-prints every component the image declares (agents, teams, workflows, knowledge instances) with IDs. Use this to discover IDs when authoring custom profiles by hand.

## models — view / switch model provider

```bash
ixora stack models show                                       # current provider + model
ixora stack models set                                        # interactive picker
ixora stack models set anthropic                              # non-interactive
ixora stack models set openai
ixora stack models set google
ixora stack models set ollama
ixora stack models set openai-compatible                      # any OpenAI-API-compatible endpoint
ixora stack models set custom                                 # raw provider + base URL
```

`set` prompts for the API key (unless `ollama`, which is keyless). The API container needs a restart to pick up provider changes — `ixora stack restart` after.

## Runtime detection order

`compose` command resolution, in order:

1. `docker compose` (v2 plugin)
2. `podman compose`
3. `docker-compose` (legacy v1 standalone)

Force one with `--runtime docker` or `--runtime podman` at any `stack` command. Useful in environments where both are installed and ixora picks the wrong one.

## Where things live

```
~/.ixora/
├── .env                         # provider keys, SYSTEM_<ID>_*, IXORA_*
├── ixora-systems.yaml           # registered systems (managed + external)
├── docker-compose.yml           # generated by `start` from the current profile
└── profiles/
    └── <system-id>.yaml         # component picks for `mode: custom`
```

For multi-system specifics (add/remove/start/stop, managed vs external, env var naming), see [systems.md](systems.md).
