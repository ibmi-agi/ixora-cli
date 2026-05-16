# Configuration Commands

Inspect and edit ixora configuration without leaving the CLI.

```bash
ixora stack config show
ixora stack config set <key> <value>
ixora stack config edit
ixora stack config edit <system>          # switch a system between Full and Custom
ixora stack config reset <system>         # back to Full, custom YAML → .bak
ixora stack config show-system <system>   # alias: show-sys
ixora stack components list
ixora stack agents [system]
```

All edits go to `~/.ixora/.env` or `~/.ixora/profiles/<id>.yaml`. **Container changes require `ixora stack restart` to take effect.**

---

## `config show`

Pretty-prints the active config table. Groups values by category (Model, Deployment, Per-system credentials, etc.) and notes the source file for each section.

```bash
$ ixora stack config show

  Model
    IXORA_AGENT_MODEL           anthropic:claude-sonnet-4-6
    IXORA_TEAM_MODEL            anthropic:claude-haiku-4-5
    Provider                    Anthropic

  Deployment
    IXORA_PROFILE               full
    IXORA_VERSION               v0.1.2
    IXORA_CLI_MODE              false
    IXORA_DB_ISOLATION          per-system

  Systems
    default   managed   profile=full
    prod      managed   profile=security

  Files
    .env                ~/.ixora/.env
    ixora-systems.yaml  ~/.ixora/ixora-systems.yaml
```

Default subcommand — running `ixora stack config` is the same as `ixora stack config show`.

---

## `config set <key> <value>`

Write a key into `~/.ixora/.env`.

```bash
ixora stack config set ANTHROPIC_API_KEY 'sk-ant-xxx'
ixora stack config set IXORA_CLI_MODE true
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack config set SYSTEM_PROD_PASS 'new-password'
ixora stack restart
```

`set` adds the key if missing or updates it in place; quoting is preserved. After mutating runtime settings, restart the stack so the API container picks them up.

---

## `config edit`

Open the active `.env` in `$EDITOR` (falls back to `vi`).

```bash
ixora stack config edit
```

Use this for bulk changes or when you need to add custom env vars (e.g. `OPENAI_BASE_URL` for OpenAI-compatible providers).

Always `ixora stack restart` after exiting the editor.

---

## `config edit <system>`

Switch a system between **Full** and **Custom** deployment modes — interactive picker for `Custom`.

```bash
ixora stack config edit prod
```

| Choice | Effect |
|---|---|
| **Full** | Every component the image declares is enabled. Removes `~/.ixora/profiles/<id>.yaml` if present. |
| **Custom** | Multi-select picker for agents, teams, and workflows. Writes `~/.ixora/profiles/<id>.yaml`. |

This is the source of truth for "which agents/teams/workflows run on this specific system." The agent picker is also reachable directly via `ixora stack agents [system]` — see below.

---

## `config reset <system>`

Drop a system's custom profile and revert it to Full.

```bash
ixora stack config reset prod
```

Behavior:
- `~/.ixora/profiles/prod.yaml` is backed up to `prod.yaml.bak` (not deleted).
- The system's entry in `ixora-systems.yaml` flips back to `mode: full`.
- Next `restart` rebuilds the compose without the custom component list.

To bring the custom selection back, rename `<id>.yaml.bak` to `<id>.yaml` and re-run `config edit <system>` (or just `restart`).

---

## `config show-system <system>` (alias `show-sys`)

Print a system's current mode and resolved component list.

```bash
$ ixora stack config show-system prod

  System:  prod  (mode: custom)
  Profile YAML:  ~/.ixora/profiles/prod.yaml

  AGENTS (2 enabled)
    - sql-services
    - knowledge

  TEAMS (1 enabled)
    - security-team

  WORKFLOWS (0 enabled)
```

For `mode: full`, this resolves against the image manifest to show what's actually loaded — same information without needing to inspect compose logs.

---

## `stack agents [system]`

Focused entry point for editing only the agents on a system. Same picker as `config edit`, but skips the Full/Custom prompt (selecting any agent implies Custom).

```bash
ixora stack agents              # interactive system picker, then agent picker
ixora stack agents prod         # pick directly for 'prod'
```

When no system is supplied and 2+ exist, you're prompted to choose one.

---

## `stack components list`

Inspect every component the deployed image declares — agents, teams, workflows, and knowledge bases. Useful when authoring a custom profile YAML by hand.

```bash
ixora stack components list
ixora stack components list --refresh             # re-fetch from the image, ignore cache
ixora stack components list --image ghcr.io/ibmi-agi/ixora-api:v0.1.3
```

Options:

| Flag | Effect |
|---|---|
| `--refresh` | Bypass the cached manifest and re-fetch from the image. |
| `--image <ref>` | Inspect a different image (e.g. a pre-release tag) without changing the active deployment. |

Output groups by type (AGENTS / TEAMS / WORKFLOWS / KNOWLEDGE) and lists the IDs you can put into `~/.ixora/profiles/<id>.yaml`.

---

## Keys you'll commonly set

| Key | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` | Model provider credentials |
| `IXORA_AGENT_MODEL` / `IXORA_TEAM_MODEL` | `provider:model` strings |
| `IXORA_PROFILE` | Stack shape (`full` / `mcp` / `cli`) — usually set via `--profile` |
| `IXORA_VERSION` | Image tag — usually set via `stack upgrade <version>` |
| `IXORA_CLI_MODE` | `true` to bypass MCP regardless of `IXORA_PROFILE` |
| `IXORA_DB_ISOLATION` | `shared` for one big DB; unset for per-system DBs |
| `IXORA_API_PORT` / `DB_PORT` | Override default host ports (`18000` / `15432`) |
| `OLLAMA_URL` / `OLLAMA_MODEL` | Ollama endpoint and model |
| `SYSTEM_<ID>_HOST` / `_USER` / `_PASS` / `_PORT` | IBM i credentials for a managed system |
| `SYSTEM_<ID>_AGENTOS_KEY` | External-system AgentOS API key |

`ixora stack config show` lists everything currently set; use `ixora stack config set KEY VALUE` followed by `ixora stack restart` to change any of them.

---

## See also

- [`../configuration.md`](../configuration.md) — full file format reference
- [`profiles.md`](profiles.md) — Full vs Custom and the stack profile flags
- [`systems.md`](systems.md) — per-system config workflows
