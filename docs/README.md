# ixora CLI Documentation

`ixora` is the CLI for managing the **ixora** AI agent platform on IBM i — and for talking to the AgentOS server that ships with it.

The CLI exposes two distinct command trees:

| Tree | Lives at | Purpose |
|---|---|---|
| **Stack** | `ixora stack <cmd>` | Manage the local ixora deployment — install, start/stop containers, configure systems, switch models |
| **Runtime** | `ixora <cmd>` (top-level groups) | Talk to a running AgentOS — list/run agents, browse traces, query the knowledge base, manage schedules |

---

## Start here

- [Getting Started](getting-started.md) — install the CLI, run `ixora stack install`, talk to your first agent
- [Configuration](configuration.md) — `~/.ixora/.env`, `ixora-systems.yaml`, where state lives
- [Global Options](global-options.md) — every top-level flag (`--system`, `--json`, `--profile`, …)
- [Output Formats](output-formats.md) — `--output table|json|compact`, `--json id,name`, scripting tips
- [Troubleshooting](troubleshooting.md) — common installation and connection errors

---

## Stack commands — `ixora stack ...`

Local-machine operations: provisioning, lifecycle, configuration.

- [Stack overview](stack/README.md)
- [Install](stack/install.md) — first-time setup walkthrough
- [Lifecycle](stack/lifecycle.md) — `start`, `stop`, `restart`, `status`, `logs`, `upgrade`, `uninstall`, `version`
- [Systems](stack/systems.md) — manage multiple IBM i targets (`stack system add|remove|list|default|start|stop|restart`)
- [Profiles & deployment shapes](stack/profiles.md) — `--profile full|mcp|cli`, agent profiles, CLI mode, DB isolation
- [Configuration commands](stack/config.md) — `stack config`, `stack agents`, `stack components`
- [Model provider](stack/models.md) — `stack models show|set`

---

## Runtime commands — `ixora <group> ...`

Direct calls into the AgentOS API on the targeted system.

- [Runtime overview](runtime/README.md) — system targeting (`--system`, `--url`), default system, externals
- [`agents`](runtime/agents.md) — list, get, run (streaming or one-shot), continue paused runs, resume SSE, cancel
- [`teams`](runtime/teams.md) — list, get, run, continue, resume, cancel
- [`workflows`](runtime/workflows.md) — list, get, run, continue, resume, cancel
- [`sessions`](runtime/sessions.md) — list, get, create, update, delete, runs
- [`traces`](runtime/traces.md) — list, get, stats, search
- [`memories`](runtime/memories.md) — list, get, create, update, delete, topics, stats, optimize
- [`knowledge`](runtime/knowledge.md) — upload, list, get, search, status, delete, config
- [`evals`](runtime/evals.md) — list, get, run, delete
- [`approvals`](runtime/approvals.md) — list, get, resolve
- [`schedules`](runtime/schedules.md) — list, get, create, update, delete, pause, resume, runs, get-run, trigger
- [`metrics`](runtime/metrics.md) — get, refresh
- [`databases`](runtime/databases.md) — migrate
- [`registries`](runtime/registries.md) — list
- [`components`](runtime/components.md) — list, get, create, update, delete, config
- [`models`](runtime/models.md) — list available models in AgentOS
- [`status`](runtime/status.md) — AgentOS resource overview
- [`health`](runtime/health.md) — ping `/health`, report uptime and latency
- [`docs`](runtime/docs.md) — inspect the raw HTTP API (`/openapi.json`)

---

## Conventions used in these docs

- `<required>` — argument or option you must provide.
- `[optional]` — argument or option that may be omitted.
- Code blocks show full commands, prefixed with `$` for the input line when output is shown.
- Output samples are shortened with `…` where they would otherwise wrap.

When `ixora` is referenced in flowing text it always means the installed binary (e.g. `npm install -g @ibm/ixora`).
