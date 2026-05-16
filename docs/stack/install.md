# `ixora stack install`

First-time interactive setup. Detects your container runtime, collects credentials, writes `~/.ixora/`, pulls images, and starts the stack.

```bash
ixora stack install
```

If `~/.ixora/` already exists, you're offered **Reconfigure** (re-run the prompts with current values as defaults) or **Cancel**.

---

## What it asks

### 1. Container runtime
Auto-detected from PATH. Checks in order:
1. `docker compose` (v2)
2. `podman compose`
3. legacy `docker-compose` (v1)

Force a choice with `--runtime docker` or `--runtime podman`.

### 2. Model provider

| Provider | Default agent model | Default team model | API key required |
|---|---|---|---|
| **Anthropic** (recommended) | Claude Sonnet 4.6 | Claude Haiku 4.5 | yes |
| **OpenAI** | GPT-4o | GPT-4o-mini | yes |
| **Google** | Gemini 2.5 Pro | Gemini 2.5 Flash | yes |
| **Ollama** | llama3.1 | llama3.1 | no — runs locally |
| **OpenAI-compatible** | you specify | you specify | endpoint + key |
| **Custom** | you specify | you specify | you specify the env var name |

For **Ollama**, the installer also asks for:
- URL (default `http://host.docker.internal:11434` — Linux users should override with `http://172.17.0.1:11434`)
- Model name (default `llama3.1`)

And tests connectivity before continuing.

### 3. IBM i connection

| Prompt | Default | Notes |
|---|---|---|
| IBM i hostname | — | Required. Hostname or IP. |
| IBM i username | — | Required. |
| IBM i password | — | Required. Input is masked. |
| IBM i port | `8076` | Mapepire service port. |

### 4. Display name

Human-readable label for this system — shown in the UI and `ixora stack system list`. Defaults to the hostname.

### 5. Agent profile

Which agents the API loads:

| Profile | What's in it |
|---|---|
| `full` | 3 agents + 2 teams + 1 workflow — everything |
| `sql-services` | SQL Services agent (Db2 for i querying, performance monitoring) |
| `security` | Security agent + multi-system security team + assessment workflow |
| `knowledge` | Knowledge retrieval agent only — lightest footprint |

Pick `knowledge` for the fastest startup. Pre-select with `--agent-profile <name>` to skip the prompt.

> **Agent profile ≠ stack profile.** This selects which *agents* the API loads. `--profile full|mcp|cli` selects which *containers* run. See [`profiles.md`](profiles.md).

### 6. Image version

Lists available release tags from `ghcr.io`. Defaults to the latest semver. If the registry can't be reached, falls back to `latest`. Override with `--image-version v0.1.2`.

### 7. Deployment mode (per system)

| Mode | Effect |
|---|---|
| `full` (default) | The system enables every component the image declares. |
| `custom` | Interactive picker writes `~/.ixora/profiles/<id>.yaml` listing the chosen agents/teams/workflows. |

Skip the prompt with `--mode full` or `--mode custom`.

---

## What gets written

```
~/.ixora/
  .env                  # secrets + IXORA_PROFILE + per-system credentials
  ixora-systems.yaml    # the new system entry
  docker-compose.yml    # generated from your settings
  profiles/<id>.yaml    # only when mode = custom
```

See [`../configuration.md`](../configuration.md) for the file formats.

---

## What it does, in order

1. Detect / verify the container runtime.
2. Detect existing `~/.ixora/` → offer Reconfigure / Cancel.
3. Collect answers (steps 2–7 above).
4. Write `~/.ixora/.env` (mode `0600`) and `ixora-systems.yaml`.
5. Generate `docker-compose.yml` from the chosen `--profile` and systems list.
6. `docker pull` images (skip with `--no-pull`).
7. `docker compose up -d` to start everything.
8. Poll `/health` on each `api-<id>` for up to 30s.
9. Print the success banner with URLs.

On success:

```
 ixora is running!

  Stack:   full
  UI:      http://localhost:13000
  API:     http://localhost:18000
  MCP:     http://localhost:18000/mcp
  Agent:   full

  Manage with: ixora stack start|stop|restart|status|upgrade|config|logs
  Talk to AgentOS: ixora agents|teams|workflows|traces|sessions|knowledge ...
  Config dir:  ~/.ixora
```

---

## Reinstall / reconfigure

```bash
ixora stack install              # detects ~/.ixora — pick Reconfigure
ixora stack uninstall --purge    # nuke containers + volumes; rm -rf ~/.ixora for a fresh start
```

---

## Non-interactive install (CI)

```bash
ixora stack install \
  --runtime docker \
  --profile mcp \
  --image-version v0.1.2
```

Credentials and API keys still have to be present somewhere — pre-seed `~/.ixora/.env` before running, and the installer will use those values as defaults (so the prompts only ask for what's missing).

---

## See also

- [`profiles.md`](profiles.md) — pick `full` / `mcp` / `cli`
- [`systems.md`](systems.md) — add more IBM i systems later
- [`lifecycle.md`](lifecycle.md) — start, stop, restart after install
- [`../troubleshooting.md`](../troubleshooting.md#installation) — failure modes during install
