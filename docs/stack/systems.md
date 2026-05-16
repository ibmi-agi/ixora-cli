# Systems

ixora can manage multiple IBM i targets, plus register external AgentOS endpoints. The system list lives in `~/.ixora/ixora-systems.yaml`; credentials live in `~/.ixora/.env`.

```bash
ixora stack system add
ixora stack system remove <id>
ixora stack system list
ixora stack system default [id] [--clear]
ixora stack system start|stop|restart <id>
```

---

## Two kinds of systems

| Kind | Lifecycled by ixora? | Container set | Use case |
|---|---|---|---|
| `managed` | Yes — full `api-<id>`/`mcp-<id>`/per-system DB | yes | An IBM i system ixora provisions and runs locally |
| `external` | No — ixora only routes runtime calls | none | Any AgentOS-compatible URL (another local AgentOS instance, a teammate's lab, a cloud endpoint) |

External systems always count as "available" (no container check), so they participate naturally in the implicit-target rules.

---

## `stack system add`

Interactive by default; pre-fill anything you already know.

```bash
ixora stack system add                                     # interactive
ixora stack system add --kind managed --id prod --name "Production"
ixora stack system add --kind external --id personal \
  --url http://localhost:8080 [--key sk-xxx]
```

Options:

| Flag | Applies to | Meaning |
|---|---|---|
| `--kind managed\|external` | both | Skip the kind prompt. |
| `--id <id>` | both | System ID — lowercase, alphanumeric + hyphens. Used in container names. |
| `--name <name>` | both | Human-readable display name. |
| `--url <url>` | external only | AgentOS endpoint URL. |
| `--key <key>` | external only | AgentOS API key. Stored as `SYSTEM_<ID>_AGENTOS_KEY` in `.env`. |

For **managed** systems, the installer additionally prompts for IBM i hostname, username, password, port, and agent profile (`full`/`sql-services`/`security`/`knowledge`).

When adding a 2nd system to an existing per-system-DB deployment, the next `ixora stack restart` adds a one-shot `db-init` container that creates the new `ai_<id>` database and enables pgvector.

---

## `stack system remove <id>`

Removes the system from `ixora-systems.yaml` and cleans up `SYSTEM_<ID>_*` keys in `.env`. Works for both kinds.

```bash
ixora stack system remove prod
```

The containers for that system stop on the next `ixora stack restart` (because the regenerated compose no longer includes them). Volumes are preserved.

---

## `stack system list`

```
$ ixora stack system list

  ID         KIND       URL                            NAME              PROFILE
* default    managed    http://localhost:18000         Development       full
  prod       managed    http://localhost:18001         Production        security
  personal   external   http://localhost:8080          Personal AgentOS  —
```

- `*` marks the configured default.
- Managed systems' URLs are derived from their assigned API port.
- External systems show the URL you provided.

The list is also available as JSON:

```bash
ixora stack system list --json
ixora stack system list --json id,kind,url
```

---

## `stack system default [id] [--clear]`

The default kicks in when 2+ systems are available and no `--system` flag is passed.

```bash
ixora stack system default                # show current default
ixora stack system default prod           # set
ixora stack system default --clear        # unset — require --system again
```

Equivalent env-var form: `IXORA_DEFAULT_SYSTEM=prod`.

Targeting resolution (full rules in [`../global-options.md`](../global-options.md)):

1. Explicit `--system <id>` wins.
2. `--url` wins over both (skips system lookup).
3. Configured default + in the running set → use it.
4. Exactly one available → use it.
5. Otherwise → error.

---

## `stack system start | stop | restart <id>`

Per-system lifecycle. Only valid for **managed** systems.

```bash
ixora stack system start prod
ixora stack system stop prod
ixora stack system restart prod
```

Starts/stops just the containers for that one system (`api-<id>`, `mcp-<id>` if not in CLI mode, and the shared `agentos-db` if it isn't already up).

Calling on an external errors with a clear message:

```
$ ixora stack system start personal
Error: personal is an external system — ixora does not lifecycle-manage external endpoints.
       Start it on the external side instead.
```

---

## Credentials in `~/.ixora/.env`

Per-system blocks managed by add/remove:

```env
# Managed system credentials
SYSTEM_PROD_HOST='ibmi-prod.example.com'
SYSTEM_PROD_PORT='8076'
SYSTEM_PROD_USER='PRODUSER'
SYSTEM_PROD_PASS='...'

# External system AgentOS key
SYSTEM_PERSONAL_AGENTOS_KEY='sk-xxx'
```

To rotate a managed system's password:

```bash
ixora stack config set SYSTEM_PROD_PASS 'new-password'
ixora stack restart
```

---

## Per-system database

By default, each managed system gets its own `ai_<id>` Postgres database (inside the shared `agentos-db` container). The container DB name lowercases the system id and replaces non-alphanumerics with `_`:

```
id: my-prod  →  database: ai_my_prod
```

To switch to a shared single database:

```bash
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack restart
```

See [`../configuration.md#per-system-database-isolation-default`](../configuration.md) for the migration steps.

---

## Putting it together — common flows

### Add a second IBM i system, then target it

```bash
ixora stack system add                       # interactive — adds 'prod'
ixora stack restart                          # creates api-prod, mcp-prod, ai_prod DB
ixora --system prod agents list              # one-off
ixora stack system default prod              # persistent default
ixora agents list                            # now uses prod
```

### Register a teammate's AgentOS

```bash
ixora stack system add --kind external --id alice \
  --url http://10.0.0.42:18000 --key sk-team-xxx
ixora --system alice agents list
```

### Quickly point at a brand-new ad-hoc URL

```bash
ixora --url http://localhost:18099 agents list      # skips system resolution entirely
```

---

## See also

- [`profiles.md`](profiles.md) — stack shapes (`full` / `mcp` / `cli`) and agent profiles
- [`config.md`](config.md) — switch a system between full and custom modes
- [`../runtime/README.md`](../runtime/README.md) — how runtime commands choose a target
