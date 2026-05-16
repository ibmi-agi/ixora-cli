# Stack lifecycle — `ixora stack`

> Canonical command reference: [`../docs/stack/install.md`](../docs/stack/install.md), [`../docs/stack/lifecycle.md`](../docs/stack/lifecycle.md), [`../docs/stack/config.md`](../docs/stack/config.md), [`../docs/stack/models.md`](../docs/stack/models.md). This page covers workflows and gotchas the docs don't transcribe.

Local-stack management. All commands live under `ixora stack <cmd>`. None of them respect `--system` / `--url` — they target the local deployment directly. Containers (`agentos-db`, `api-<id>`, `mcp-<id>`, `ui`) are spawned via `docker compose` (or `podman compose`) against the generated `~/.ixora/docker-compose.yml`.

**Prereqs**: Node ≥ 20 and a running Docker (or Podman) daemon.

---

## install — first-time setup

```bash
ixora stack install
```

Interactive. Prompt sequence:

1. **Container runtime** — auto-detects `docker compose` v2, then `podman compose`, then legacy `docker-compose` v1. Forceable with `--runtime docker` / `--runtime podman`.
2. **Model provider** — `anthropic` | `openai` | `google` | `ollama` | `openai-compatible` | `custom`. Sets the appropriate env vars and prompts for an API key (skipped for local Ollama).
3. **IBM i connection** — host, user, password, port (default `8076`). Written as `SYSTEM_DEFAULT_*` in `~/.ixora/.env`. A `default` managed system gets registered in `ixora-systems.yaml`.
4. **Display name** — free-text label for this system (shown in `system list` and the UI).
5. **Agent profile** — `full` / `sql-services` / `security` / `knowledge`. Which agents the API loads. Pre-select with `--agent-profile <name>` to skip. See [`profiles.md`](profiles.md).
6. **Image version** — registry tag list. Defaults to the latest semver; override with `--image-version v0.1.2`. Falls back to `latest` if the registry is unreachable.
7. **Deployment mode** (only when the image supports it) — `full` (every component the agent profile declares) or `custom` (interactive picker writes `~/.ixora/profiles/<id>.yaml`). Pre-select with `--mode full|custom`.

Re-running `install` against an existing `~/.ixora/.env` offers **Reconfigure** (re-walk with current values as defaults) or **Cancel**.

After install the stack **is** started — `install` ends with `docker compose up -d` and a `/health` poll. If the banner doesn't appear, see [`../docs/troubleshooting.md`](../docs/troubleshooting.md) (Installation section).

Full walkthrough: [`../docs/stack/install.md`](../docs/stack/install.md).

---

## start / stop / restart / status

```bash
ixora stack start [service]            # all services in the active profile, or one
ixora stack stop  [service]
ixora stack restart [service]
ixora stack status                     # service list + active profile + image version
```

`start` writes/rewrites `~/.ixora/docker-compose.yml` from the current profile and runs `compose up -d`. With no `--profile`, the persisted `IXORA_PROFILE` is reused.

`status` shows: each service's state, container name, port mapping, active **stack profile** (`full`/`mcp`/`cli`), `Backend` (`MCP` or `ibmi CLI`), runtime (`docker compose` / `podman compose`), and image tag.

```bash
ixora stack status --profile mcp       # restrict the table to mcp-scope services
ixora stack status --profile cli       # only DB + API rows
```

Stack profile is persisted in `IXORA_PROFILE`. Switching is non-destructive — narrower profiles (e.g. `stop --profile mcp` while running `full`) only touch services in scope.

`--profile` semantics in detail: [`profiles.md`](profiles.md) and [`../docs/stack/profiles.md`](../docs/stack/profiles.md).

---

## upgrade / uninstall / logs / version

```bash
ixora stack upgrade                   # latest tag for the configured channel
ixora stack upgrade v0.1.3            # pin specific version
ixora stack upgrade --no-pull         # don't fetch; use already-pulled image
ixora stack uninstall                 # stop services + remove images; volumes preserved
ixora stack uninstall --purge         # ALSO removes the agentos-db volume — DESTROYS DATA
ixora stack logs                      # tail all services in the active profile
ixora stack logs api-default          # tail one service
ixora stack version                   # CLI + image versions
```

`upgrade [version]` accepts bare versions (`0.1.3`) or `v`-prefixed (`v0.1.3`); both normalize internally. Writes `IXORA_VERSION` and regenerates compose.

To roll back: `ixora stack upgrade <older-version>`.

`logs` is bounded by default. Asking for a container that isn't in the active profile fails fast (e.g. `logs ui --profile mcp` errors instead of silently no-op'ing).

**`uninstall --purge` is destructive** — confirm before running. To back up first:

```bash
docker compose -p ixora -f ~/.ixora/docker-compose.yml --env-file ~/.ixora/.env \
  exec -T agentos-db sh -c 'pg_dump -U "$POSTGRES_USER" -d ai_default' > backup.sql
```

---

## config — view and edit deployment configuration

```bash
ixora stack config show                              # current ~/.ixora/.env table (masked)
ixora stack config set <key> <value>                 # programmatic update; preserves comments
ixora stack config edit                              # open .env in $EDITOR
ixora stack config edit <system>                     # Full/Custom picker for that system
ixora stack config reset <system>                    # drop custom profile, revert to Full (.bak created)
ixora stack config show-system <system>              # mode + resolved component list (alias: show-sys)
```

Common keys (`config set <KEY> <VALUE>`):

| Key | Purpose |
|---|---|
| `IXORA_CLI_MODE` | `true` to run API in CLI mode regardless of stack profile |
| `IXORA_DB_ISOLATION` | `per-system` (default) or `shared` |
| `IXORA_PROFILE` | Stack shape (`full`/`mcp`/`cli`) — usually set via `--profile` |
| `IXORA_VERSION` | Pin the image tag used on `start`/`upgrade` |
| `IXORA_DEFAULT_SYSTEM` | Implicit `--system` when 2+ are available |
| `IXORA_API_PORT` / `DB_PORT` | Override host ports (`18000` / `15432`) |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Ollama endpoint + model |
| `SYSTEM_<ID>_HOST` / `_USER` / `_PASS` / `_PORT` | IBM i credentials for a managed system |
| `SYSTEM_<ID>_AGENTOS_KEY` | External-system AgentOS API key |

**Always restart after `config set`** — the API container reads these at startup:

```bash
ixora stack config set IXORA_DB_ISOLATION shared && ixora stack restart
```

`config edit <system>` is the same plumbing as the agent picker — it switches a system's `mode` field between `full` and `custom`. `config reset <system>` drops a custom profile back to Full (the `.yaml` is backed up to `.yaml.bak`).

---

## agents — edit which components a system loads

```bash
ixora stack agents              # pick a managed system interactively
ixora stack agents <system>     # open the picker directly for that system
```

**Managed only.** Externals are configured at their AgentOS source — running `stack agents` against an external (or with no managed systems registered) errors out with a hint to `ixora stack install` or `ixora stack system add`.

Wraps the same component picker `install --mode custom` uses. Selecting any agent flips the system to `mode: custom` (no Full/Custom prompt). Writes `~/.ixora/profiles/<system>.yaml`. Restart the system after editing:

```bash
ixora stack system restart <id>
```

---

## components — inspect the deployed image

```bash
ixora stack components list                       # cached manifest
ixora stack components list --refresh             # re-fetch from the installed image
ixora stack components list --image ghcr.io/...   # override the image ref
```

Pretty-prints every component the image declares (agents, teams, workflows, knowledge instances) with IDs. Use this to discover IDs when authoring `~/.ixora/profiles/<id>.yaml` by hand.

Not to be confused with `ixora components` (runtime): the **stack** version inspects the **image's manifest**; the **runtime** version manages live components on the AgentOS server. See [`observability.md`](observability.md).

---

## models — view / switch model provider

```bash
ixora stack models show                                       # current provider + agent/team models
ixora stack models set                                        # interactive picker
ixora stack models set anthropic                              # non-interactive
ixora stack models set openai
ixora stack models set google
ixora stack models set ollama
ixora stack models set openai-compatible                      # any OpenAI-API-compatible endpoint
ixora stack models set custom                                 # raw provider + base URL
```

`set` prompts for the API key (unless `ollama`, which is keyless). For OpenAI-compatible, it also prompts for the base URL. The API container needs a restart to pick up provider changes:

```bash
ixora stack models set anthropic && ixora stack restart
```

Not to be confused with `ixora models list` (runtime), which queries the AgentOS server for what models it can load. See [`../docs/runtime/models.md`](../docs/runtime/models.md).

---

## Service names

Compose service names are **templated per system**, not fixed:

| Service | Present when | Notes |
|---|---|---|
| `agentos-db` | Always | Shared Postgres for every managed system |
| `db-init` | Per-system isolation with 2+ systems | One-shot DB provisioner; transient |
| `api-<system_id>` | Always (per managed system) | E.g. `api-default`, `api-prod` |
| `mcp-<system_id>` | Stack profile `full` or `mcp` | Absent under `--profile cli` |
| `ui` | Stack profile `full` only | Single instance shared across systems |

Pass any of these to `stack logs|restart|stop|start <service>`. Run `ixora stack status` for the live list.

The status output has two columns that look similar:

- **SERVICE** — canonical compose service name (`api-default`, `agentos-db`, …). What scripts should use.
- **NAME** — actual container name compose assigns: `ixora-<service>-<replica>`, e.g. `ixora-api-default-1`.

The CLI accepts **either form** — it strips the `ixora-` prefix and `-<N>` replica suffix. Prefer the SERVICE form in scripts; it's stable across replicas and project names.

---

## Runtime detection order

Compose command resolution, in order:

1. `docker compose` (v2 plugin)
2. `podman compose`
3. `docker-compose` (legacy v1 standalone)

Force one with `--runtime docker` or `--runtime podman` at any `stack` command. Useful when both are installed and ixora picks the wrong one.

---

## Where things live

```
~/.ixora/
├── .env                         # provider keys, SYSTEM_<ID>_*, IXORA_* (mode 0600)
├── ixora-systems.yaml           # registered systems (managed + external)
├── docker-compose.yml           # generated by `start` from the current profile
├── profiles/
│   └── <system-id>.yaml         # component picks for systems in mode: custom
└── user_tools/                  # custom tool definitions mounted into api-<id>
```

Full file formats: [`../docs/configuration.md`](../docs/configuration.md).

---

## Common flows

### First-time install through to first agent run

```bash
ixora stack install                               # interactive
ixora stack status                                # confirm everything Up
ixora status                                      # AgentOS reports agents loaded?
ixora agents list
ixora agents run <id> "<message>" --stream
```

### Switch from `--profile full` to `--profile cli` (CLI mode, no UI)

```bash
ixora stack start --profile cli                   # regenerates compose; removes orphan ui/mcp containers
ixora stack status                                # confirm
```

### Apply a config change

```bash
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack restart                               # API reads at startup
ixora stack config show | grep IXORA_DB_ISOLATION
```

### Roll back to a previous image

```bash
ixora stack upgrade v0.1.2                        # downgrade by re-pinning
ixora stack status                                # confirm
```

---

## See also

- [`../docs/stack/install.md`](../docs/stack/install.md), [`../docs/stack/lifecycle.md`](../docs/stack/lifecycle.md), [`../docs/stack/config.md`](../docs/stack/config.md), [`../docs/stack/models.md`](../docs/stack/models.md)
- [`../docs/troubleshooting.md`](../docs/troubleshooting.md) — installation and runtime failure modes
- [`systems.md`](systems.md) — multi-system add/remove/start/stop, managed vs external
- [`profiles.md`](profiles.md) — the three "profile" concepts deconflicted
