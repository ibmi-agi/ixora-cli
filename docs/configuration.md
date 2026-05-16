# Configuration

All ixora state lives under `~/.ixora/`. Two files are user-editable; everything else is auto-generated.

```
~/.ixora/
  .env                    # secrets & settings (mode 0600)
  ixora-systems.yaml      # IBM i system definitions
  docker-compose.yml      # auto-generated — do not edit
  profiles/<id>.yaml      # per-system custom component picks (only for mode: custom)
  user_tools/             # custom tool definitions mounted into the API container
```

Use `ixora stack config show` to print the active configuration with the file paths it came from.

---

## `~/.ixora/.env`

Plain `KEY='value'` lines. Created by `ixora stack install`. Edit with `ixora stack config edit`, or programmatically with `ixora stack config set KEY VALUE`. Always restart after editing: `ixora stack restart`.

```env
# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-...'

# Default IBM i system credentials
SYSTEM_DEFAULT_HOST='myibmi.example.com'
SYSTEM_DEFAULT_PORT='8076'
SYSTEM_DEFAULT_USER='MYUSER'
SYSTEM_DEFAULT_PASS='mypassword'

# Stack deployment shape — full | mcp | cli
IXORA_PROFILE='full'
IXORA_VERSION='v0.1.2'

# Optional: route agents through the bundled ibmi CLI inside the API
# container instead of the per-system MCP server. --profile cli implies
# this. Set manually to keep the UI (--profile full) but skip MCP.
# IXORA_CLI_MODE='true'

# Optional: shared single-database layout (default is per-system DB)
# IXORA_DB_ISOLATION='shared'
```

### Per-system credentials

For every system added with `ixora stack system add`, a block like the following is appended:

```env
SYSTEM_PROD_HOST='ibmi-prod.example.com'
SYSTEM_PROD_PORT='8076'
SYSTEM_PROD_USER='PRODUSER'
SYSTEM_PROD_PASS='...'

# External-only — AgentOS API key for the external endpoint
SYSTEM_PERSONAL_AGENTOS_KEY='sk-xxx'
```

`ixora stack system remove <id>` cleans these up automatically.

### Read / write from the CLI

```bash
ixora stack config show                  # render the full config table
ixora stack config edit                  # open .env in $EDITOR
ixora stack config set IXORA_CLI_MODE true
ixora stack restart                      # regenerate the compose, apply changes
```

---

## `~/.ixora/ixora-systems.yaml`

Declarative list of IBM i systems. Managed via `ixora stack system add|remove|list`; safe to read but normally not edited by hand.

```yaml
# Ixora Systems Configuration
# Manage with: ixora stack system add|remove|list
systems:
  - id: default
    name: 'Development'
    profile: full
    agents: []
  - id: prod
    name: 'Production'
    profile: security
    agents: []
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Lowercase + hyphenated identifier. Used in container names (`api-<id>`, `mcp-<id>`) and credential env keys (`SYSTEM_<ID>_*`). |
| `name` | string | Human-readable display name shown in lists and UI. |
| `profile` | string | Agent profile loaded by the API: `full`, `sql-services`, `security`, `knowledge`. |
| `agents` | array | Optional list of agent IDs. Empty = use the profile default. |
| `mode` | string | (Optional) `full` or `custom`. `custom` reads `~/.ixora/profiles/<id>.yaml`. |
| `kind` | string | `managed` (default — ixora lifecycles it) or `external` (AgentOS URL ixora only routes to). |
| `url` | string | External systems only — AgentOS endpoint URL. |

---

## Per-system database isolation (default)

Each system gets its **own** `ai_<id>` Postgres database (and its own `/data` volume) inside the shared `agentos-db` container. Sessions, memories, knowledge, and learnings stay isolated.

- **One system**: just `ai_default`, nothing else.
- **2+ systems**: a one-shot `db-init` container creates each missing `ai_<id>` and enables `pgvector`. Adding a system later just works on the next `ixora stack restart`.
- System IDs are lowercased; non-alphanumerics become `_` in database names. `my-prod` → `ai_my_prod`.

To switch to a shared `ai` database:

```bash
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack restart
```

`ixora stack config show` reports the active mode (`per-system` / `shared`) under **Deployment**.

Switching modes does not move existing data. To migrate from per-system to shared:

```bash
docker compose -p ixora -f ~/.ixora/docker-compose.yml --env-file ~/.ixora/.env \
  exec -T agentos-db sh -c 'pg_dump -U "$POSTGRES_USER" -d ai_default | psql -U "$POSTGRES_USER" -d ai'
```

---

## CLI mode (skip the MCP server)

Set `IXORA_CLI_MODE=true` to have agents call the bundled `ibmi` CLI inside the `api-<id>` container instead of the per-system MCP server. Two ways to enable:

```bash
# Stack profile — also drops the UI (DB + API only):
ixora stack start --profile cli

# Override while keeping the UI on (e.g., --profile full):
ixora stack config set IXORA_CLI_MODE true
ixora stack restart
```

In CLI mode:

- The `mcp-<id>` container(s) are not started.
- Each `api-<id>` connects to its system using the stored `SYSTEM_<ID>_*` credentials, surfaced as `IBMI_HOST/USER/PASS/PORT` inside the container.
- PASE shell execution is not available.
- `ixora stack status` / the running banner show `Backend: ibmi CLI` and no MCP endpoints.

To revert: `ixora stack start --profile mcp` (or `--profile full`), or set `IXORA_CLI_MODE=false` and `ixora stack restart`.

See [`stack/profiles.md`](stack/profiles.md) for a deeper comparison of `full` / `mcp` / `cli`.

---

## Container architecture

| Service | Image | Port | Role | Profiles |
|---|---|---|---|---|
| `agentos-db` | `agnohq/pgvector:18` | `15432` | Postgres + pgvector | all |
| `db-init` | `agnohq/pgvector:18` | — | One-shot DB creator (only with 2+ per-system isolated DBs) | all (when applicable) |
| `mcp-<id>` | `ghcr.io/ibmi-agi/ixora-mcp-server` | internal | MCP server bridging IBM i via Mapepire | `full`, `mcp` |
| `api-<id>` | `ghcr.io/ibmi-agi/ixora-api` | `18000+` | FastAPI backend serving the AgentOS endpoints | all |
| `ui` | `ghcr.io/ibmi-agi/ixora-ui` | `13000` | Next.js web interface | `full` |

For multi-system deployments, API ports increment per system:

```
api-default → localhost:18000
api-prod    → localhost:18001
api-staging → localhost:18002
```

The bundled UI connects to the first system (`:18000`). Use the other ports to reach other systems' APIs directly (or use `ixora --system <id> agents list`).

---

## Where to next

- Stack profile detail → [`stack/profiles.md`](stack/profiles.md)
- Manage multiple systems → [`stack/systems.md`](stack/systems.md)
- Override config from the CLI → [`stack/config.md`](stack/config.md)
- Troubleshoot installs → [`troubleshooting.md`](troubleshooting.md)
