# Global Options

All flags listed here are accepted at the top level (before the subcommand). They split into two groups:

- **Stack-targeting flags** — consumed by `ixora stack ...` commands.
- **AgentOS-targeting flags** — consumed by every top-level runtime group (`ixora agents`, `ixora traces`, …).

Most flags can be set once globally and reused.

---

## Version & help

```bash
ixora --cli-version          # or: -V
ixora --help
ixora agents --help          # group-level help
ixora agents run --help      # subcommand help
```

---

## Stack shape & install-time flags

| Flag | Default | Purpose |
|---|---|---|
| `--profile <name>` | `full` | Stack shape: `full` (DB + API + MCP + UI), `mcp` (DB + API + MCP, no UI), `cli` (DB + API only, no MCP container). See [`stack/profiles.md`](stack/profiles.md). |
| `--mode <name>` | (interactive) | Per-system deployment mode: `full` (every component the image declares) or `custom` (interactive picker). Used at install time. |
| `--image-version <tag>` | latest registry tag | Pin a specific image version, e.g. `v0.1.2`. |
| `--no-pull` | off | Skip `docker pull` on `stack start`/`upgrade`. Useful in CI/offline scenarios. |
| `--purge` | off | Used with `stack uninstall` to remove volumes too. |
| `--runtime <name>` | auto-detect | Force `docker` or `podman`. |

Example:

```bash
ixora stack start --profile mcp --image-version v0.1.2 --no-pull
ixora stack uninstall --purge --runtime docker
```

---

## AgentOS targeting flags

These select which AgentOS instance the runtime commands talk to.

| Flag | Purpose |
|---|---|
| `-s, --system <name>` | Target a specific configured system by its ID. Wins over the configured default. Implicit when only one system is currently running. |
| `--url <url>` | Override the AgentOS endpoint entirely. Skips system resolution — useful for ad-hoc targets. |
| `--key <key>` | Override the AgentOS API key for this invocation. |
| `--timeout <seconds>` | Request timeout. Floating-point seconds. |

Resolution order when running `ixora agents list`:

1. `--url` set → use it directly (system lookup skipped).
2. `--system <name>` set → resolve that system from `~/.ixora/ixora-systems.yaml`.
3. Configured default (`ixora stack system default <id>`) is set **and** in the running set → use it.
4. Exactly one available system → use it.
5. Otherwise → error asking for `--system` or `IXORA_DEFAULT_SYSTEM`.

Externals always count as "available" (no container check), so the rules above include them naturally.

Examples:

```bash
ixora --system prod agents list
ixora --url http://localhost:8081 agents list      # ad-hoc target
ixora --system prod --key sk-xxx agents list       # per-call key override
ixora --timeout 60 traces get abc123               # longer timeout for slow traces
```

---

## Output flags

| Flag | Behavior |
|---|---|
| `--no-color` | Disable ANSI colors in output. |
| `--json [fields]` | Emit JSON instead of a table. Pass a comma list (e.g. `--json id,name`) to project a subset of fields. |
| `-o, --output <format>` | Output format: `json`, `table`, or `compact`. Auto-detects from TTY when omitted (TTY → `table`, non-TTY → `json`). `compact` applies to `agents run` / `agents continue`. |

See [`output-formats.md`](output-formats.md) for examples and the full auto-detect matrix.

---

## Combining global flags

Global flags can be combined freely:

```bash
ixora --system prod -o json agents list
ixora --system prod --no-color knowledge search "indexing"
ixora --url http://localhost:8081 --timeout 120 --json id,name agents list
```

---

## Environment variables

| Variable | Effect |
|---|---|
| `IXORA_DEFAULT_SYSTEM` | Acts like a persistent `--system <id>` when set. `ixora stack system default <id>` is the canonical way to set this. |
| `NO_COLOR` | Honored alongside `--no-color`. |

System-scoped variables in `~/.ixora/.env` (e.g. `SYSTEM_PROD_HOST`, `SYSTEM_PROD_AGENTOS_KEY`) are managed by `ixora stack system add` and `ixora stack config`, not set by hand. See [`configuration.md`](configuration.md).
