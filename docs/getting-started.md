# Getting Started

This page takes you from zero to a running ixora stack and your first agent run. For the deep walkthrough of every install prompt, see [`stack/install.md`](stack/install.md).

---

## Prerequisites

| Requirement | Verify with |
|---|---|
| Node.js >= 20 | `node --version` |
| Docker Desktop or Podman | `docker compose version` or `podman compose version` |
| Container runtime running | `docker info` (must not error) |
| IBM i with Mapepire service on port 8076 | reachable from your workstation |
| Model provider API key | Anthropic, OpenAI, Google — or Ollama (no key) |

---

## 1. Install the CLI

Global install:

```bash
npm install -g @ibm/ixora
ixora --cli-version
```

Or one-shot via `npx`:

```bash
npx @ibm/ixora stack install
```

---

## 2. Run the interactive installer

```bash
ixora stack install
```

The installer collects:

1. Container runtime (auto-detected — `docker compose`, `podman compose`, or legacy `docker-compose`).
2. Model provider (Anthropic recommended) and API key.
3. IBM i hostname, username, password, and Mapepire port (default `8076`).
4. A human-readable system display name.
5. An **agent profile** — which agents the API loads (`full`, `sql-services`, `security`, `knowledge`).
6. An image version tag.

Everything is written to `~/.ixora/`:

```
~/.ixora/
  .env                  # secrets + settings (mode 0600)
  ixora-systems.yaml    # IBM i system list
  docker-compose.yml    # auto-generated; do not edit
  user_tools/           # custom tool definitions (mounted into the API container)
```

When the health check passes, you see:

```
 ixora is running!

  Stack:   full
  UI:      http://localhost:13000
  API:     http://localhost:18000
  MCP:     http://localhost:18000/mcp
  Agent:   full
```

---

## 3. Day-to-day stack lifecycle

```bash
ixora stack status        # what's running, on which profile
ixora stack stop          # stop everything
ixora stack start         # start everything (uses the persisted --profile)
ixora stack logs api-default
ixora stack restart api-default
ixora stack upgrade       # pull latest images and restart
```

See [`stack/lifecycle.md`](stack/lifecycle.md) for details.

---

## 4. Talk to a running AgentOS

Once a system is up, the runtime commands target it implicitly:

```bash
ixora status              # AgentOS overview: agents, teams, knowledge, databases
ixora agents list
ixora agents run sql-agent "Show the 10 largest tables in QSYS2"
ixora traces list
ixora knowledge search "DB2 for i indexing"
```

Use `--stream` to follow long-running agents in real time:

```bash
ixora agents run sql-agent "audit job log volumes" --stream
```

---

## 5. Multiple systems — managed and external

ixora can manage more than one IBM i system, and also register **external** AgentOS endpoints (any AgentOS-compatible URL) that it does not lifecycle-manage.

```bash
# Add another managed system (interactive — prompts for hostname/credentials)
ixora stack system add

# Register an external AgentOS endpoint
ixora stack system add \
  --kind external --id personal \
  --url http://localhost:8080 [--key sk-xxx]

ixora stack system list           # shows KIND + URL columns; default marked with *
```

Target a specific system per-call, or set a persistent default:

```bash
ixora --system prod agents list           # one-off override
ixora stack system default prod           # persistent default
ixora agents list                         # now uses prod
ixora --system dev agents list            # flag still wins
ixora stack system default --clear        # require --system again
```

See [`stack/systems.md`](stack/systems.md) and [`runtime/README.md`](runtime/README.md) for the full rules.

---

## 6. Use with Claude Code

This repo doubles as a [Claude Code plugin marketplace](https://docs.anthropic.com/en/docs/claude-code/plugins) exposing the `use-ixora` skill, which teaches Claude how to drive the CLI for you.

```bash
claude plugin marketplace add ibmi-agi/ixora-cli
claude plugin install use-ixora@ixora-cli
```

Or via `npx skills`:

```bash
npx skills add ibmi-agi/ixora-cli
```

Claude activates the skill automatically (e.g. "install ixora", "run an agent on prod") or you can call it explicitly as `/ixora-cli:use-ixora`.

---

## Where to go next

- Detailed install walkthrough → [`stack/install.md`](stack/install.md)
- Choose a stack shape → [`stack/profiles.md`](stack/profiles.md)
- Every global flag → [`global-options.md`](global-options.md)
- Run your first agent → [`runtime/agents.md`](runtime/agents.md)
