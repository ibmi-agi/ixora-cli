# Endpoint, auth, `user_tools` & container `ibmi`

> `agent_builder.py` resolves which AgentOS to talk to (and where to write `tools.yaml`) from `~/.ixora/ixora-systems.yaml` + `.env`, mirroring `ixora-cli/src/lib/agentos-resolver.ts` — so it targets the same system your `ixora` commands do. Check a selection before mutating: `uv run "$AB" resolve --system <id>`.

## Which endpoint

| Inputs | Outcome |
|---|---|
| `--url <url>` | used verbatim; system resolution skipped |
| `--system <id>` | that system |
| 1 configured system | implicit pick |
| 2+, `IXORA_DEFAULT_SYSTEM` set | the default |
| 2+, no default | error — pass `--system` |

- **Managed** → `http://localhost:(18000 + index-among-managed)` (honors `IXORA_API_PORT`; externals don't take port slots).
- **External** → its `url:` verbatim.
- **Auth:** `--key`, else `SYSTEM_<ID>_AGENTOS_KEY` from `.env` (id upper-cased, `-`→`_`); absent → no header (the local default).

> The script does **not** run `docker compose ps` to check liveness — it resolves and lets the HTTP call fail clearly if the stack is down. Check first with `ixora stack status` / `ixora health --system <id>`.

## Container `ibmi` (introspection)

`uv run "$AB" ibmi --system <id> -- <args>` execs the `ibmi` binary inside the managed system's `api-<id>` container (via `docker`/`podman compose`, auto-detected; override with `--compose-cmd`). It connects through the container's `IBMI_*` env — the creds Ixora deploys with — so introspection matches run time. **Managed only**; for external systems it errors (no local container). `resolve` shows `ibmi_via` for managed systems.

**Flag ordering:** target flags (`--system` / `--url` / `--key` / `--timeout`) go **before** the `--`; everything after `--` is passed verbatim to the container `ibmi`. Append `--raw` there for JSON, e.g. `uv run "$AB" ibmi --system <id> -- tables <SCHEMA> --raw` (that's the container ibmi's JSON flag, distinct from `ixora`'s `--json`). A `--system` placed *after* `--` is swallowed into the ibmi args and silently ignored.

## Where `tools.yaml` is written

| Target | `user_tools_dir` | Effect |
|---|---|---|
| managed | `~/.ixora/user_tools/` | bind-mounted to `/data/user_tools`; read at run time, no restart |
| external / `--url` | `null` | host path unknown → `--user-tools-dir`, out-of-band, or toolset-only |

`create-tool-yaml` writes `<user_tools_dir>/<agent_id>/tools.yaml`; the dir is shared across managed systems, so `<agent_id>` must be unique.

## Common flags

`--system` · `--url` · `--key` · `--user-tools-dir` · `--compose-cmd` · `--timeout` · `--ixora-dir` (testing).

Get `--db-id` for `register`: `ixora status --system <id> --json | jq -r '.databases[]?'` (usually one).

## See also
- [`tool-yaml.md`](tool-yaml.md) · [`agent-config.md`](agent-config.md) · `use-ixora` skill → `references/systems.md`
