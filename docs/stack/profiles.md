# Profiles & Deployment Shapes

ixora has **two unrelated** notions of "profile":

| | What it controls | Set by |
|---|---|---|
| **Stack profile** (`--profile`) | Which *containers* run on your machine | `--profile full\|mcp\|cli` |
| **Deployment mode** (`--mode`) | Which *components* the API loads inside its container | Install prompt; per-system `mode:` in `ixora-systems.yaml`, picks in `profiles/<id>.yaml` |

This page covers both.

---

## Stack profile — `--profile full | mcp | cli`

| Profile | Containers | When to use |
|---|---|---|
| `full` (default) | DB + API + MCP + Carbon UI | Local development, you want the bundled UI on `:13000` |
| `mcp` | DB + API + MCP | Headless backend — bring your own UI, or embed |
| `cli` | DB + API only (no MCP container) | Agents call the bundled `ibmi` CLI inside the API container directly. Sets `IXORA_CLI_MODE=true` |

`--profile` applies to every lifecycle command: `start`, `stop`, `restart`, `status`, `logs`, `upgrade`.

```bash
ixora stack start --profile full     # all containers including UI (default)
ixora stack start --profile mcp      # DB + api-<sys> + mcp-<sys>, no UI
ixora stack start --profile cli      # DB + api-<sys> only — CLI mode, no mcp-<sys>
ixora stack status --profile mcp     # report on the mcp scope only
ixora stack logs --profile cli       # tail db/api; mcp-<sys> doesn't exist here
```

### Persistence

The active profile is written to `~/.ixora/.env` as `IXORA_PROFILE`. Subsequent commands without `--profile` reuse it:

```bash
ixora stack start --profile cli      # writes IXORA_PROFILE=cli
ixora stack restart                  # honors the persisted profile (cli)
ixora stack stop                     # also honors cli scope
```

Switching profiles is non-destructive. Profile narrowing (e.g. `stop --profile mcp` while running `full`) only touches containers in that scope:

```bash
ixora stack start --profile full     # all containers up, UI on :13000
ixora stack stop --profile mcp       # stops db/api/mcp; UI keeps running
ixora stack status --profile full    # only ui shown as remaining
```

Switching to `--profile cli` regenerates the compose without `mcp-<sys>` services; the next `start` removes the now-orphaned MCP containers via `--remove-orphans`. Switching back to `full` / `mcp` brings them back.

### Guard rail

Asking for a container that isn't part of the active profile errors out instead of silently no-op'ing:

```
$ ixora stack logs ui --profile mcp
Error: ui is not in the active stack profile (mcp); only 'full' includes the UI.

$ ixora stack logs mcp-default --profile cli
Error: mcp-default is not started in the 'cli' stack profile.
       Use --profile mcp or --profile full.
```

### Migration notes

- `--profile api` was renamed to `--profile mcp`. The old name still works (with a one-line warning), and `IXORA_PROFILE=api` is treated as `mcp`.
- Older versions used `--profile sql-services|security|knowledge` for a named **agent** profile. Named agent profiles are gone — component selection is now the `--mode full|custom` deployment mode (install-only). A stale `IXORA_PROFILE=sql-services|security|knowledge` in `.env` is coerced to the default stack profile `full` (one-line warning unless it already equals `full`).

---

## CLI mode (`--profile cli`)

CLI mode has agents call the bundled `ibmi` CLI inside the `api-<id>` container directly — no MCP server in the path. Smaller surface, simpler debugging.

### Two ways to turn it on

```bash
# 1. As a stack profile — also drops the UI:
ixora stack start --profile cli

# 2. As an override, keeping the current stack profile (e.g. full, so the UI stays):
ixora stack config set IXORA_CLI_MODE true
ixora stack restart
```

### What changes

- `mcp-<id>` container(s) are **not** started.
- Each `api-<id>` connects to its IBM i using the stored `SYSTEM_<ID>_*` credentials, surfaced inside the container as `IBMI_HOST` / `IBMI_USER` / `IBMI_PASS` / `IBMI_PORT`.
- PASE shell execution is unavailable in CLI mode.
- `ixora stack config show` lists `IXORA_CLI_MODE  true` under **Deployment** and notes whether it came from `--profile cli` or the env var.
- The running banner and `ixora stack status` show `Backend: ibmi CLI` and no MCP endpoint.

### Reverting

```bash
ixora stack start --profile mcp           # back to MCP-backed
# or
ixora stack config set IXORA_CLI_MODE false
ixora stack restart
```

---

## Deployment mode (per system)

Selected during `ixora stack install` (or `ixora stack system add` for additional systems). Persisted per-system as `mode:` in `~/.ixora/ixora-systems.yaml`:

```yaml
systems:
  - id: default
    name: 'Development'
    kind: managed
    mode: full           # ← deployment mode (full | custom)
```

| Deployment mode | What's enabled |
|---|---|
| `full` | Every agent / team / workflow / knowledge base the image declares |
| `custom` | Exactly the components you picked in the installer's multi-select, stored in `~/.ixora/profiles/<id>.yaml` |

### Switching a system's deployment mode

Use the config commands — `mode:` is managed by the CLI and the custom picks live in a separate `profiles/<id>.yaml`, so hand-editing `ixora-systems.yaml` alone is not enough. To pick individual components, switch the system to **custom** mode:

```bash
ixora stack config edit <system_id>       # opens the Full / Custom picker
ixora stack agents <system_id>            # focused picker (skips Full/Custom prompt)
```

Custom mode writes `~/.ixora/profiles/<id>.yaml` listing exactly which agents/teams/workflows to enable on that system. See [`config.md`](config.md) for details.

To revert a system to Full (and back up the custom profile to `<id>.yaml.bak`):

```bash
ixora stack config reset <system_id>
```

---

## Per-system database isolation

Default = **per-system**: each IBM i system gets its own `ai_<id>` Postgres database inside the shared `agentos-db` container. Sessions, memories, knowledge, and learnings stay isolated.

| Setting | Behavior |
|---|---|
| (unset / `per-system`) | Each system → its own `ai_<id>` database and `/data` volume. With 2+ systems, a `db-init` container provisions missing DBs. |
| `IXORA_DB_ISOLATION=shared` | One `ai` database holds everything. Useful for shared analytics. |

```bash
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack restart                         # regenerates the compose
ixora stack config show                     # shows mode under Deployment
```

Switching modes does not move data. Migration steps live in [`../configuration.md#per-system-database-isolation-default`](../configuration.md).

---

## Putting it together — common combinations

```bash
# Local dev with the UI (default)
ixora stack start --profile full

# Headless service: API + MCP, no UI
ixora stack start --profile mcp

# CLI-backed agents, no MCP server, no UI
ixora stack start --profile cli

# CLI-backed agents, still with the UI
ixora stack config set IXORA_CLI_MODE true
ixora stack restart                          # active --profile (e.g. full) stays
```

---

## See also

- [`lifecycle.md`](lifecycle.md) — start/stop/restart with `--profile`
- [`config.md`](config.md) — Full vs Custom per system
- [`../configuration.md`](../configuration.md) — every env var, including `IXORA_CLI_MODE` and `IXORA_DB_ISOLATION`
