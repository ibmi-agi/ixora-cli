# Multi-system management — `ixora stack system`

> Canonical command reference: [`../docs/stack/systems.md`](../docs/stack/systems.md). This page covers the kind discriminator, the implicit-pick rule, env var conventions, and the worked examples — workflows that the docs don't transcribe.

`ixora` operates against one or more **systems**. Each is one of two kinds:

| Kind | What it is | Lifecycle commands? |
|---|---|---|
| `managed` | An ixora-provisioned IBM i stack (compose-based, runs locally) | Yes — `system start\|stop\|restart` work |
| `external` | An existing AgentOS-compatible URL (local or remote) ixora doesn't lifecycle-manage | No — `system start <id>` hard-errors |

Both kinds are valid targets for the runtime commands (`ixora agents`, `ixora traces`, etc.). The discriminator, agent profile, and URL all live in `~/.ixora/ixora-systems.yaml`; credentials live in `~/.ixora/.env`.

---

## `system add`

```bash
ixora stack system add                                     # fully interactive
ixora stack system add --kind managed --id dev --name "Development"
ixora stack system add --kind external --id personal \
  --url http://localhost:8080 [--key sk-xxx]
```

Flags (all optional; missing ones get prompted):

- `--kind managed | external` — skip the kind prompt
- `--id <id>` — system ID (lowercase, alphanumeric + hyphens; used in URLs, container names, and env var names)
- `--name <name>` — display name (free text)
- `--agent-profile <name>` — **managed only**; pre-select agent profile (`full` / `sql-services` / `security` / `knowledge`). See [`profiles.md`](profiles.md).
- `--mode <full|custom>` — **managed only**; deployment mode
- `--url <url>` — **external only**; the AgentOS URL
- `--key <key>` — **external only**; optional API key (stored as `SYSTEM_<ID>_AGENTOS_KEY`)

Managed adds prompt for IBM i host/port/user/password and the agent profile. External adds skip everything except URL + optional key.

When adding a 2nd system to an existing per-system-DB deployment, the next `ixora stack restart` adds a one-shot `db-init` container that creates the new `ai_<id>` database and enables `pgvector`.

---

## `system remove` / `list`

```bash
ixora stack system remove <id>            # works for both kinds; cleans up env keys
ixora stack system list                   # KIND + URL + NAME + PROFILE columns; default marked *
ixora stack system list --json id,kind,url,profile
```

`remove <id>` strips `SYSTEM_<ID>_*` keys from `.env` and the system entry from `ixora-systems.yaml`. Containers for that system stop on the next `ixora stack restart` (the regenerated compose drops them). Volumes are preserved.

`system list` is the default subcommand — `ixora stack system` alone runs it.

---

## `system start` / `stop` / `restart`

```bash
ixora stack system start   <id>           # managed only — boots that system's containers
ixora stack system stop    <id>
ixora stack system restart <id>
```

Calling these on an **external** ID hard-errors with a hint:

```
Error: 'personal' is an external system — ixora does not lifecycle-manage external endpoints.
       Start it on the external side instead.
```

To "start" an external, start the AgentOS instance behind its URL using whatever owns it.

---

## `system default`

```bash
ixora stack system default               # show the current default
ixora stack system default dev           # set 'dev' as the default
ixora stack system default --clear       # unset — require --system again
```

The default is used when **2+ systems are available** and `--system` is omitted. With 0 or 1 available, the default is irrelevant. `--system <id>` on any command always wins over the default.

Equivalent env-var form: `IXORA_DEFAULT_SYSTEM=<id>`.

---

## Implicit-pick rule

A system is **available** if:

- it's `managed` AND its containers are running, OR
- it's `external` (no docker check — externals are always considered available)

Then:

```
available count = 0  →  error: "no system available"
available count = 1  →  implicit pick — no flag needed
available count ≥ 2  →  use the default (if set), otherwise require --system
```

`--url <url>` skips this entirely — it overrides system resolution and hits the URL directly. `--key <key>` overrides the API key for that one invocation. Both are useful for one-off probes against unregistered AgentOS endpoints.

---

## Env var naming convention

System IDs map to env var names by **uppercasing and replacing hyphens with underscores**:

| System ID | Env var prefix |
|---|---|
| `default` | `SYSTEM_DEFAULT_` |
| `prod` | `SYSTEM_PROD_` |
| `my-system` | `SYSTEM_MY_SYSTEM_` |
| `external-lab` | `SYSTEM_EXTERNAL_LAB_` |

### Managed system env vars

| Var | Purpose |
|---|---|
| `SYSTEM_<ID>_HOST` | IBM i hostname |
| `SYSTEM_<ID>_PORT` | IBM i port (default 8076) |
| `SYSTEM_<ID>_USER` | IBM i username |
| `SYSTEM_<ID>_PASS` | IBM i password |

### External system env vars

| Var | Purpose |
|---|---|
| `SYSTEM_<ID>_AGENTOS_KEY` | API key (optional; only if the URL needs auth) |

The URL itself is stored on the system entry in `ixora-systems.yaml`, not in `.env`.

Write any of these with `ixora stack config set <key> <value>` (never hand-edit `.env`).

---

## `ixora-systems.yaml` shape

```yaml
# Ixora Systems Configuration
# Manage with: ixora stack system add|remove|list
systems:
  - id: default
    name: 'Default'
    kind: managed
    profile: full           # agent profile (see profiles.md)
    mode: full              # deployment mode (full | custom)
    agents: []              # optional override list

  - id: dev
    name: 'Development'
    kind: managed
    profile: sql-services
    mode: custom            # custom subset lives at ~/.ixora/profiles/dev.yaml

  - id: personal
    name: 'Personal local AgentOS'
    kind: external
    url: 'http://localhost:8080'

default: dev                # optional — set/cleared via `system default`
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Lowercase, alphanumeric + hyphens |
| `name` | string | yes | Human-readable display name |
| `kind` | `managed` \| `external` | yes | Discriminator (defaults to `managed` if missing) |
| `profile` | `full`\|`sql-services`\|`security`\|`knowledge` | managed | Agent profile — which agents the API loads |
| `mode` | `full` \| `custom` | managed | Deployment mode |
| `agents` | array of IDs | no | Optional override; empty = use the profile default |
| `url` | string | external | External AgentOS endpoint |

See [`profiles.md`](profiles.md) for the difference between `profile`, `mode`, and the stack-level `--profile`.

---

## Multi-system DB layout

By default each managed system gets its own `ai_<id>` Postgres database inside the **shared** `agentos-db` container. Sessions, memory, knowledge, and learnings are per-system isolated.

To consolidate everything into one shared `ai` database:

```bash
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack restart
```

A single-system deployment with the default `per-system` isolation just gets `ai_default` (no extra container). With 2+ systems, a one-shot `db-init` service provisions the additional databases on first boot.

Switching modes does not move data. Migration steps: [`../docs/configuration.md`](../docs/configuration.md) (see "Per-system database isolation").

---

## Worked examples

### Add a managed prod system

```bash
ixora stack system add --kind managed --id prod --name "Production"
# prompts: host, port, user, password, agent profile, mode

ixora stack system start prod                    # boots its containers
ixora stack system list                          # confirm
ixora --system prod agents list                  # target prod for runtime ops
```

### Register an external local AgentOS

```bash
ixora stack system add --kind external --id personal --url http://localhost:8080
ixora --system personal agents list              # works
ixora stack system start personal                # ERROR — externals not managed
```

### Switch the default

```bash
ixora stack system list                          # see what's there
ixora stack system default prod                  # bare commands now hit prod
ixora agents list                                # implicit prod
ixora --system dev agents list                   # one-off override
ixora stack system default --clear               # back to "must specify --system"
```

### Rotate a managed system's password

```bash
ixora stack config set SYSTEM_PROD_PASS 'new-password'
ixora stack system restart prod
```

### Probe an ad-hoc AgentOS without registering

```bash
ixora --url http://localhost:18099 agents list                  # one-off
ixora --url http://10.0.0.42:18000 --key sk-xxx agents list     # with auth
```

---

## See also

- [`../docs/stack/systems.md`](../docs/stack/systems.md) — canonical command reference
- [`../docs/configuration.md`](../docs/configuration.md) — `~/.ixora/.env` and `ixora-systems.yaml` formats
- [`profiles.md`](profiles.md) — agent profile vs deployment mode vs stack profile
- [`stack-lifecycle.md`](stack-lifecycle.md) — host-wide lifecycle commands
