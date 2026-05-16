# Stack Lifecycle

Day-to-day operations on the running ixora deployment.

```bash
ixora stack start [service]
ixora stack stop [service]
ixora stack restart [service]
ixora stack status
ixora stack logs [service]
ixora stack upgrade [version]
ixora stack uninstall
ixora stack version
```

All of these honor the persisted `IXORA_PROFILE` from `~/.ixora/.env` unless overridden with `--profile`. See [`profiles.md`](profiles.md).

---

## `start [service]`

Start the stack, or a single service.

```bash
ixora stack start                  # everything in the active profile
ixora stack start api-default      # one container
ixora stack start --profile mcp    # change shape, persist IXORA_PROFILE=mcp
ixora stack start --profile cli    # CLI mode — no MCP container, sets IXORA_CLI_MODE
ixora stack start --no-pull        # don't refresh images first
```

`start` is idempotent — already-running services stay running. If the profile changed since the last run, `--remove-orphans` is applied so dropped containers are cleaned up.

---

## `stop [service]`

```bash
ixora stack stop                     # stop everything (in the active profile scope)
ixora stack stop ui                  # stop just the UI
ixora stack stop --profile mcp       # only stop services in the mcp scope
```

Stopping with a narrower profile is safe: services outside that scope keep running.

```bash
ixora stack start --profile full     # UI + DB + API + MCP up
ixora stack stop --profile mcp       # stops DB + API + MCP; UI keeps running
```

---

## `restart [service]`

```bash
ixora stack restart                  # everything
ixora stack restart api-default      # one service
```

Regenerates `~/.ixora/docker-compose.yml` from current config before restarting — so config changes from `ixora stack config set ...` take effect.

---

## `status`

Shows what's running, the active profile, and per-system service health.

```bash
$ ixora stack status

  Stack:    full
  Profile:  IXORA_PROFILE=full
  Backend:  MCP   (set IXORA_CLI_MODE=true for CLI mode)
  Runtime:  docker compose
  Image:    ghcr.io/ibmi-agi/ixora-api:v0.1.2

  SERVICE         STATUS    PORTS
  agentos-db      Up        :15432
  api-default     Up        :18000
  mcp-default     Up        (internal)
  ui              Up        :13000

  Talk to it:  ixora agents list | ixora traces list | ...
```

Scope output to a specific profile:

```bash
ixora stack status --profile mcp     # only DB + API + MCP rows
ixora stack status --profile cli     # only DB + API rows (no MCP container)
```

---

## `logs [service]`

Tail container logs. Omit the service for an aggregated view.

```bash
ixora stack logs                       # all services in the active profile
ixora stack logs api-default           # one service
ixora stack logs mcp-prod              # per-system MCP server
ixora stack logs agentos-db
```

Asking for a container that isn't in the active profile fails fast:

```
$ ixora stack logs ui --profile mcp
Error: ui is not in the active stack profile (mcp); only 'full' includes the UI.
       Use --profile full or omit --profile.
```

---

## `upgrade [version]`

Pull the latest images and restart.

```bash
ixora stack upgrade                    # latest tag
ixora stack upgrade v0.1.3             # specific version
ixora stack upgrade 0.1.3              # 'v' prefix optional
```

Writes the new tag to `IXORA_VERSION` in `.env` and regenerates the compose file.

To roll back to a previous version:

```bash
ixora stack upgrade v0.1.2             # downgrade by re-pinning
```

---

## `uninstall`

Stop services and remove images. Volumes are preserved by default.

```bash
ixora stack uninstall                  # safe — keeps Postgres data
ixora stack uninstall --purge          # DESTRUCTIVE — also drops volumes
```

To fully wipe ixora from the machine:

```bash
ixora stack uninstall --purge
rm -rf ~/.ixora
```

> Back up first if you have valuable knowledge/memory data — see [`../troubleshooting.md#cleanup`](../troubleshooting.md#cleanup).

---

## `version`

```bash
$ ixora stack version

  CLI:    @ibm/ixora v0.3.4
  Image:  ghcr.io/ibmi-agi/ixora-api:v0.1.2
  Runtime: docker compose v2.30.0
```

The CLI version also surfaces via `ixora --cli-version`.

---

## Service names you can pass

For single-service ops, the service name matches the container name:

| Service | When it exists | Notes |
|---|---|---|
| `agentos-db` | always | Shared Postgres (per-system DBs live inside this single container) |
| `db-init` | per-system isolation with 2+ systems | One-shot; only relevant during startup |
| `api-<id>` | always | One per system in `ixora-systems.yaml` |
| `mcp-<id>` | profiles `full` / `mcp` | One per system — skipped in `cli` profile |
| `ui` | profile `full` only | First system gets the bundled UI |

`<id>` matches the `id:` in `~/.ixora/ixora-systems.yaml`.

---

## See also

- [`profiles.md`](profiles.md) — what each profile starts
- [`config.md`](config.md) — config changes that need a restart
- [`systems.md`](systems.md) — per-system lifecycle (`ixora stack system start <id>`)
- [`../troubleshooting.md`](../troubleshooting.md) — failure modes
