# Ixora Quickstart

Deploy AI agents for IBM i in minutes. This guide walks you through installing the ixora CLI, connecting to your IBM i system, and launching the agent stack.

---

**Contents**

- [1. Prerequisites](#1-prerequisites)
- [2. Install the CLI](#2-install-the-cli)
- [3. Run `ixora install`](#3-run-ixora-install)
- [4. Configuration files](#4-configuration-files)
- [5. Open the local UI](#5-open-the-local-ui)
- [6. Connect to the Agno Control Plane (optional)](#6-connect-to-the-agno-control-plane-optional)
- [7. Common commands](#7-common-commands)
- [8. Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

| Requirement | How to verify |
|---|---|
| **Node.js >= 18** | `node --version` |
| **Docker Desktop or Podman** | `docker compose version` or `podman compose version` |
| **Docker/Podman running** | `docker info` (must not error) |
| **IBM i with Mapepire service** | Port 8076 reachable from your workstation |
| **IBM i user profile** | Username and password with sufficient authority |
| **AI model provider API key** | Anthropic, OpenAI, Google, or Ollama (local) |

> **Ollama users:** No API key is needed. Ollama must be running and listening on all interfaces.
> macOS/Windows users can use the default `host.docker.internal` URL. Linux users should
> use their host IP (e.g., `http://172.17.0.1:11434`).

---

## 2. Install the CLI

```bash
npm install -g @ibm/ixora
```

Or run directly without a global install:

```bash
npx @ibm/ixora install
```

Verify the installation:

```bash
ixora --cli-version
```

---

## 3. Run `ixora install`

```bash
ixora install
```

The installer walks you through each step interactively.

### 3.1 Container runtime detection

The CLI auto-detects your container runtime. It checks for `docker compose` (v2), `podman compose`, and legacy `docker-compose` (v1) in that order. If an existing `~/.ixora/` directory is found, you are prompted to **Reconfigure** or **Cancel**.

### 3.2 Select a model provider

Choose the AI model provider that powers your agents:

| Provider | Agent model | Team model | API key required |
|---|---|---|---|
| **Anthropic** (recommended) | Claude Sonnet 4.6 | Claude Haiku 4.5 | Yes |
| **OpenAI** | GPT-4o | GPT-4o-mini | Yes |
| **Google** | Gemini 2.5 Pro | Gemini 2.5 Flash | Yes |
| **Ollama** | llama3.1 (default) | llama3.1 (default) | No |
| **Custom** | You specify | You specify | You specify |

### 3.3 Enter your API key

For Anthropic, OpenAI, or Google, enter your API key (input is masked).

For **Ollama**, you are prompted for:
- Ollama URL (default: `http://host.docker.internal:11434`)
- Model name (default: `llama3.1`)

The CLI tests connectivity to Ollama before continuing.

For **Custom**, enter the `provider:model` strings for agent and team models, plus the environment variable name for your key.

### 3.4 IBM i connection

| Prompt | Default | Notes |
|---|---|---|
| IBM i hostname | — | Required. Hostname or IP of your IBM i system |
| IBM i username | — | Required. IBM i user profile |
| IBM i password | — | Required. Masked input |
| IBM i port | `8076` | Mapepire service port |

### 3.5 Display name

Enter a human-readable name for this system. Defaults to the hostname you entered. This label appears in the UI and configuration files.

### 3.6 Select an agent profile

| Profile | Description |
|---|---|
| `full` | All agents, teams, and workflows (3 agents, 2 teams, 1 workflow) |
| `sql-services` | SQL Services agent for database queries and performance monitoring |
| `security` | Security agent, multi-system security team, and assessment workflow |
| `knowledge` | Knowledge agent only — documentation retrieval (lightest footprint) |

Start with `knowledge` if you want the fastest startup and smallest resource footprint.

### 3.7 Select an image version

The CLI fetches available release tags from the container registry. Pick a specific semver version (e.g., `v0.0.11`) or accept the default. If the registry is unreachable, it falls back to `latest`.

### 3.8 Automatic deployment

After all prompts, the CLI:

1. Writes configuration files to `~/.ixora/`
2. Pulls container images from `ghcr.io`
3. Starts services via `docker compose up -d`
4. Runs health checks (30-second timeout)

On success, you see:

```
 ixora is running!

  UI:      http://localhost:3000
  API:     http://localhost:8000
  Profile: full

  Manage with: ixora start|stop|restart|status|upgrade|config|logs
  Config dir:  ~/.ixora
```

---

## 4. Configuration files

All configuration lives in `~/.ixora/`. The `.env` and `ixora-systems.yaml` files are the ones you edit. The compose file is auto-generated on every start.

```
~/.ixora/
  .env                    # Secrets and settings (0600 permissions)
  ixora-systems.yaml      # IBM i system definitions
  docker-compose.yml      # Auto-generated — do not edit directly
  user_tools/             # Custom tool definitions (mounted into API container)
```

<details>
<summary><strong>Example: ~/.ixora/.env</strong></summary>

```env
# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-api03-...'

# IBM i connection (legacy / default system)
DB2i_HOST='myibmi.example.com'
DB2i_USER='MYUSER'
DB2i_PASS='mypassword'
DB2_PORT='8076'

# Deployment
IXORA_PROFILE='full'
IXORA_VERSION='v0.1.2'

# Per-system credentials (managed by ixora install / ixora system add)
SYSTEM_DEFAULT_HOST='myibmi.example.com'
SYSTEM_DEFAULT_PORT='8076'
SYSTEM_DEFAULT_USER='MYUSER'
SYSTEM_DEFAULT_PASS='mypassword'
```

Edit with `ixora config edit` or `ixora config set KEY VALUE`. Restart after changes: `ixora restart`.

</details>

<details>
<summary><strong>Example: ~/.ixora/ixora-systems.yaml</strong></summary>

Single system:

```yaml
# Ixora Systems Configuration
# Manage with: ixora system add|remove|list
# Credentials stored in .env (SYSTEM_<ID>_USER, SYSTEM_<ID>_PASS)
systems:
  - id: default
    name: 'myibmi.example.com'
    profile: full
    agents: []
```

Multiple systems:

```yaml
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

| Field | Type | Description |
|---|---|---|
| `id` | string | System identifier (lowercase, alphanumeric + hyphens) |
| `name` | string | Human-readable display name |
| `profile` | string | Agent profile: `full`, `sql-services`, `security`, or `knowledge` |
| `agents` | array | Agent IDs to deploy (empty = profile default) |

Add systems with `ixora system add`. Each system gets its own MCP server and API instance.

</details>

<details>
<summary><strong>Container architecture</strong></summary>

The CLI deploys four container services per system:

| Service | Image | Port | Role |
|---|---|---|---|
| `agentos-db` | `agnohq/pgvector:18` | 5432 | PostgreSQL with pgvector for agent memory |
| `mcp-<system-id>` | `ghcr.io/ibmi-agi/ixora-mcp-server` | internal | MCP server connecting to IBM i via Mapepire |
| `api-<system-id>` | `ghcr.io/ibmi-agi/ixora-api` | 8000+ | FastAPI backend serving agent endpoints |
| `ui` | `ghcr.io/ibmi-agi/ixora-ui` | 3000 | Next.js web interface |

For multi-system deployments, API ports increment automatically:

```
api-default  → localhost:8000
api-prod     → localhost:8001
api-staging  → localhost:8002
```

The UI connects to the first system (port 8000) only. Use the individual API ports for other systems.

</details>

---

## 5. Open the local UI

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

The UI connects to the API at `http://localhost:8000` and provides:

- **Agent interaction** — chat with IBM i agents to run queries, inspect configurations, and analyze system health
- **SQL Services** — run SQL queries against Db2 for i through the SQL Services agent
- **Security assessments** — run security audits and review findings (with the `security` or `full` profile)
- **Knowledge retrieval** — search IBM i documentation and best practices

The available features depend on your selected agent profile.

---

## 6. Connect to the Agno Control Plane (optional)

[os.agno.com](https://os.agno.com) is a free cloud-hosted control plane provided by Agno. You can register your local ixora API endpoint with it to get a centralized dashboard for monitoring and managing your agent deployments.

**All data stays local.** The control plane connects to your local endpoint — no IBM i data or credentials leave your network.

To connect:

1. Create a free account at [os.agno.com](https://os.agno.com)
2. Add your local ixora API endpoint (`http://localhost:8000`) as a new environment
3. The control plane discovers your running agents and surfaces them in the dashboard

Consult the [Agno documentation](https://docs.agno.com) for detailed setup instructions.

---

## 7. Common commands

| Command | Description |
|---|---|
| `ixora status` | Show service status and deployed profile |
| `ixora logs [service]` | Tail service logs (e.g., `ixora logs api-default`) |
| `ixora stop` | Stop all services |
| `ixora start` | Start all services |
| `ixora restart [service]` | Restart all or a specific service |
| `ixora upgrade [version]` | Pull latest images and restart |
| `ixora config show` | Show current configuration |
| `ixora config set KEY VALUE` | Update a config value |
| `ixora config edit` | Open config in your editor |
| `ixora system list` | List configured IBM i systems |
| `ixora system add` | Add another IBM i system (interactive) |
| `ixora system remove <id>` | Remove a system by ID |
| `ixora uninstall` | Stop services and remove images |

---

## 8. Troubleshooting

**"Neither docker compose nor podman compose found"**
Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/). The CLI checks for `docker compose` (v2), `podman compose`, and legacy `docker-compose` (v1).

**"Docker Desktop is not running"**
Start Docker Desktop or the Podman machine. The CLI runs `docker info` to verify the daemon is available.

**Health check timeout**
Services have a 30-second startup timeout. Run `ixora logs api-default` to investigate. Common causes:
- Invalid or expired API key
- IBM i system unreachable from your workstation
- Port 8076 blocked by firewall

**Ollama unreachable from containers**
Linux users must use their host IP (e.g., `http://172.17.0.1:11434`), not `localhost`, because containers cannot reach the host via `localhost`. Ensure Ollama is running with `ollama serve`.

**Port conflicts**
Default ports: 3000 (UI), 8000 (API), 5432 (PostgreSQL). If these are in use, stop the conflicting services before starting ixora.

**Reconfiguring**
Run `ixora install` again. The CLI detects the existing `~/.ixora/` directory and offers to reconfigure.
