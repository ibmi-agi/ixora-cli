# Profiles — three things named "profile"

> Canonical reference: [`../docs/stack/profiles.md`](../docs/stack/profiles.md). This page covers the **disambiguation** and the common mix-ups — load it whenever the user says "profile" without qualification.

`ixora` overloads the word "profile" three ways. Most user confusion (and Claude's mistakes) come from picking the wrong one.

| Concept | Controls | Where it lives | Valid values | Set / changed by |
|---|---|---|---|---|
| **Stack profile** | Which *containers* run on the host | `IXORA_PROFILE` in `~/.ixora/.env` | `full` / `mcp` / `cli` | `--profile <name>` on `stack start\|stop\|restart\|status\|logs\|upgrade` |
| **Agent profile** | Which *agents* (and teams/workflows) a system's API container loads | `profile:` field in `~/.ixora/ixora-systems.yaml` (per system) | `full` / `sql-services` / `security` / `knowledge` | Install prompt; `--agent-profile <name>`; edit yaml + `ixora stack restart` |
| **Deployment mode** | Whether the agent profile applies as-is or a hand-picked subset overrides it | `mode:` field in `~/.ixora/ixora-systems.yaml` (per system) + `~/.ixora/profiles/<id>.yaml` | `full` / `custom` | `--mode <name>` at install; `ixora stack config edit <id>`; `ixora stack agents <id>` |

`full` means three different things across the three columns. Read carefully.

---

## When the user says "profile," which one do they mean?

Match against the user's verbs and adjacent terms:

| User says | Probably means |
|---|---|
| "switch to CLI profile", "no UI", "no MCP container" | **Stack profile** = `cli` |
| "headless", "API + MCP only", "drop the UI" | **Stack profile** = `mcp` |
| "set the profile to security", "load only the SQL agent", "lightest profile" | **Agent profile** |
| "use custom components", "pick which agents are enabled", "switch to Full" (after talking about per-system components) | **Deployment mode** |
| "what profile is this system on?" | Ambiguous — show both `IXORA_PROFILE` and the per-system `profile:` / `mode:` |

If unsure, run `ixora stack config show` — it prints `IXORA_PROFILE` under Deployment and each system's agent profile under Systems.

---

## Stack profile — `--profile full | mcp | cli`

| Profile | Containers | When to use |
|---|---|---|
| `full` (default) | `agentos-db`, `api-<id>`, `mcp-<id>`, `ui` | Local dev with the bundled UI |
| `mcp` | `agentos-db`, `api-<id>`, `mcp-<id>` | Backend-only (no UI). `--profile api` is accepted as a deprecated alias. |
| `cli` | `agentos-db`, `api-<id>` (no MCP container) | API runs in CLI mode (`IXORA_CLI_MODE=true`). Agents reach IBM i via the bundled `ibmi` CLI directly. PASE unavailable. |

```bash
ixora stack start --profile mcp                 # no UI; API on :18000
ixora stack start --profile cli                 # no MCP container; CLI mode
ixora stack config show | grep IXORA_PROFILE    # what's currently persisted
```

Stack profile is **sticky**: once written to `IXORA_PROFILE`, subsequent `stop|status|logs|restart|upgrade` calls without `--profile` keep the same shape. Pass `--profile` again to switch.

### CLI mode without changing stack profile

To run CLI mode under `full` (CLI mode but keep the UI):

```bash
ixora stack config set IXORA_CLI_MODE true
ixora stack restart
```

`IXORA_CLI_MODE=true` overrides the stack profile's MCP behavior — the API still runs in CLI mode even though `IXORA_PROFILE=full`.

Source: [`../docs/stack/profiles.md`](../docs/stack/profiles.md) (see "CLI mode").

---

## Agent profile — which agents load on a system

Selected at install (`ixora stack install` / `stack system add`) and stored per-system in `~/.ixora/ixora-systems.yaml`:

```yaml
systems:
  - id: default
    name: 'Development'
    profile: full           # ← agent profile
    agents: []              # empty = use the profile default
  - id: prod
    name: 'Production'
    profile: security       # ← agent profile
    agents: []
```

| Agent profile | What it enables |
|---|---|
| `full` | Every agent / team / workflow the image declares (3 + 2 + 1 by default) |
| `sql-services` | SQL Services agent — Db2 for i querying, performance monitoring |
| `security` | Security agent + multi-system security team + assessment workflow |
| `knowledge` | Knowledge retrieval agent only — lightest footprint, fastest startup |

### Switching a system's agent profile

The simplest path (small change):

```bash
# Edit the profile: line for the system, save, then:
ixora stack restart
```

The yaml is the source of truth — `restart` regenerates compose from it and the API picks up the new component set.

To pick **individual** components instead of using a named profile, switch the system to **custom** deployment mode (see below).

Source: [`../docs/stack/profiles.md`](../docs/stack/profiles.md) (see "Agent profile").

---

## Deployment mode — `full` vs `custom` (per system)

| Mode | Effect |
|---|---|
| `full` (default) | The system enables every component declared by its **agent profile**. |
| `custom` | A hand-picked subset of components from `~/.ixora/profiles/<id>.yaml` overrides the profile. |

Custom mode is for "I want most of the `full` profile but without the Knowledge agent" — pick components a la carte.

### Switching modes

```bash
ixora stack config edit <system>             # Full ↔ Custom picker (multi-select agent/team/workflow if Custom)
ixora stack agents <system>                  # Agent-only picker; selecting any agent implies Custom
ixora stack config reset <system>            # Drop custom YAML (back up to .yaml.bak), revert to Full
ixora stack config show-system <system>      # Print resolved component list for that system
```

After any of these: `ixora stack restart` (or `ixora stack system restart <id>`) for the API container to pick up changes.

`ixora stack agents <id>` only works on **managed** systems. External systems are configured at their AgentOS source.

Source: [`../docs/stack/config.md`](../docs/stack/config.md) (see "`config edit <system>`").

---

## Putting it together — example combinations

```bash
# Default local dev: stack=full, agent profile per system, default mode=full
ixora stack install

# Headless service: only DB + API + MCP, every agent loads
ixora stack start --profile mcp

# Smallest footprint: stack=cli (no MCP, no UI), agent profile=knowledge
ixora stack install --profile cli --agent-profile knowledge

# Per-system override: prod runs security agent profile, dev runs full
# (edit ~/.ixora/ixora-systems.yaml)
systems:
  - id: dev
    profile: full
  - id: prod
    profile: security

# Custom subset on prod: keep security profile but drop the workflow
ixora stack agents prod                      # interactive picker; mode flips to custom
ixora stack system restart prod
```

---

## Gotchas

- **`stack profile != agent profile`.** Setting `IXORA_PROFILE=security` is not valid — security is an agent profile, not a stack profile. Older versions of ixora accepted it; newer versions error and point at `--agent-profile`.
- **Editing `ixora-systems.yaml` requires a restart.** The API container reads its component list at startup; in-flight runs are unaffected, new runs use the new set after `ixora stack restart` (or `ixora stack system restart <id>`).
- **`agents: []` means "use the profile default."** Not "load no agents." To actually load no agents, switch to `mode: custom` with an empty `profiles/<id>.yaml`.
- **Custom mode persists across profile changes.** Switching a system from `profile: full` → `profile: security` while in `mode: custom` does not reset the picked components. Run `ixora stack config reset <system>` to drop the custom YAML and revert to the profile's defaults.
- **The deployment mode column on `stack system list` is shown only for managed systems.** Externals always show `—`.

---

## See also

- [`../docs/stack/profiles.md`](../docs/stack/profiles.md) — full reference for both notions of profile
- [`../docs/stack/config.md`](../docs/stack/config.md) — `config edit`, `config reset`, `config show-system`, `stack agents`
- [`stack-lifecycle.md`](stack-lifecycle.md) — `--profile` on lifecycle commands
- [`systems.md`](systems.md) — the per-system yaml structure
