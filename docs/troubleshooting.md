# Troubleshooting

Common failures during install and day-to-day operation, with the fix.

---

## Installation

### `Neither docker compose nor podman compose found`

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Podman](https://podman.io/). The CLI checks (in order):

1. `docker compose` (v2)
2. `podman compose`
3. legacy `docker-compose` (v1)

Force a specific runtime with `--runtime docker` or `--runtime podman`.

### `Docker Desktop is not running`

Start Docker Desktop, or the Podman machine. `ixora` runs `docker info` to verify the daemon is reachable before doing anything else.

### Health check timeout

Services have a 30-second startup timeout. Investigate with:

```bash
ixora stack logs api-default
ixora stack logs mcp-default
ixora stack logs agentos-db
```

Common causes:

- Invalid or expired API key (most common — check `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. in `~/.ixora/.env`)
- IBM i system unreachable from your workstation
- Port 8076 (Mapepire) blocked by a firewall

### Ollama unreachable from containers

On Linux, containers cannot reach the host via `localhost`. Use the host IP:

```bash
ixora stack config set OLLAMA_URL http://172.17.0.1:11434
ixora stack restart
```

macOS and Windows: the default `host.docker.internal` works as-is. Make sure Ollama is actually running (`ollama serve`).

### Port conflicts

Default host ports:

- `13000` — Carbon UI
- `18000` — first API instance (subsequent systems get 18001, 18002, …)
- `15432` — Postgres

If something else is on those ports, either stop the conflicting service or override:

```bash
ixora stack config set IXORA_API_PORT 28000
ixora stack config set DB_PORT 25432
ixora stack restart
```

The UI port is fixed in the compose template — change it manually if needed.

### Reconfiguring after install

```bash
ixora stack install   # detects existing ~/.ixora and offers Reconfigure / Cancel
```

`Reconfigure` walks through the prompts again, keeping previous answers as defaults.

---

## Runtime

### `Multiple systems are available. Specify --system <name>`

You have 2+ systems and no default set. Pick one of:

```bash
ixora --system <id> agents list             # one-off
ixora stack system default <id>             # persistent
export IXORA_DEFAULT_SYSTEM=<id>            # via env var
```

See [`global-options.md`](global-options.md) for the full resolution rules.

### `No systems available`

Either no systems are running, or no systems are configured.

```bash
ixora stack system list           # is the system registered?
ixora stack status                # are the containers up?
ixora stack start                 # start them
```

### `Could not reach AgentOS at http://localhost:18000`

The targeted API isn't reachable. Try:

```bash
ixora stack status                # is the api-<id> container Up?
ixora stack logs api-default      # error in startup?
ixora health                      # ping /health and report uptime + latency
```

### Paused agent run — `No cached paused state for run ...`

`agents continue --confirm/--reject` reads from a local cache that expires after 24h. Either:

- You waited too long → start a fresh `agents run`.
- The run was never actually paused → check `ixora traces get <run_id>` for status.

You can also continue by passing the tool-results JSON explicitly:

```bash
ixora agents continue <agent_id> <run_id> '<tool_results_json>'
```

### SSE stream dropped mid-run

Reconnect with `resume`, supplying the index of the last event you saw (0-based):

```bash
ixora agents resume <agent_id> <run_id> --last-event-index 42
```

If the buffer has been flushed, fall back to the DB by passing `--session-id`:

```bash
ixora agents resume <agent_id> <run_id> --session-id <session>
```

---

## Configuration

### `ixora stack config set` made no apparent change

Container settings are read at start time. Restart for changes to take effect:

```bash
ixora stack restart
```

### Lost track of which system is the default

```bash
ixora stack system default        # prints the current default (or "no default set")
ixora stack system list           # default marked with *
```

### `Invalid JSON for --payload` / `--filter` / `--state`

The CLI parses these client-side. Test with `jq`:

```bash
echo '{"foo": 1}' | jq .          # valid
ixora schedules create ... --payload '{"foo": 1}'

# In zsh/bash, quote the JSON to keep braces/quotes intact:
--payload '{"key":"value with spaces"}'
```

---

## Upgrading

### `ixora stack upgrade` pulls but doesn't restart

`upgrade` performs both — confirm with:

```bash
ixora stack status                # version reflects the new tag
ixora stack version               # CLI version + image version
```

Pin a specific version:

```bash
ixora stack upgrade v0.1.3
```

### Going back to a previous image version

```bash
ixora stack config set IXORA_VERSION v0.1.1
ixora stack restart
```

---

## Cleanup

### Full removal

```bash
ixora stack uninstall              # stop containers, remove images
ixora stack uninstall --purge      # also drop volumes (DESTRUCTIVE — wipes DB)
rm -rf ~/.ixora                    # remove configuration
```

`--purge` deletes the Postgres volume — sessions, memories, knowledge are gone. Back up first if you care:

```bash
docker compose -p ixora -f ~/.ixora/docker-compose.yml --env-file ~/.ixora/.env \
  exec -T agentos-db sh -c 'pg_dump -U "$POSTGRES_USER" -d ai_default' \
  > backup.sql
```
