# Multi-system management — `ixora stack system`

> **For exact flags, run `ixora stack system <verb> --help`.** This reference covers the kind discriminator, the implicit-pick rule, env var conventions, and worked examples — it does not transcribe every flag.

`ixora` operates against one or more **systems**. Each system is one of two kinds:

| Kind | What it is | Lifecycle commands? |
|---|---|---|
| `managed` | An ixora-provisioned IBM i stack (compose-based, runs locally) | Yes — `system start\|stop\|restart` work |
| `external` | An existing AgentOS-compatible URL (local or remote) ixora doesn't lifecycle-manage | No — `system start <id>` hard-errors |

Both kinds are valid targets for the runtime commands (`ixora agents`, `ixora traces`, etc.). The discriminator and URL live in `~/.ixora/ixora-systems.yaml`; credentials live in `~/.ixora/.env`.

## system add

```bash
ixora stack system add                                     # fully interactive — pick the kind
ixora stack system add --kind managed --id dev --name "Development"
ixora stack system add --kind external --id personal \
  --url http://localhost:8080 [--key sk-xxx]
```

Flags (all optional; missing ones get prompted):

- `--kind managed | external` — skip the kind prompt
- `--id <id>` — system ID (lowercase, used in URLs and env var names)
- `--name <name>` — display name (free text, shown in `system list`)
- `--url <url>` — **external only**; the AgentOS URL
- `--key <key>` — **external only**; optional API key (stored as `SYSTEM_<ID>_AGENTOS_KEY`)

Managed adds prompt for IBM i connection (host/port/user/password) and the deployment mode (Full / Custom). External adds skip everything except URL + optional key.

## system remove / list

```bash
ixora stack system remove <id>            # works for both kinds; cleans up env keys
ixora stack system list                   # KIND + URL columns; default marked with *
```

`system list` is the default subcommand — `ixora stack system` alone runs it.

## system start / stop / restart

```bash
ixora stack system start   <id>           # managed only — boots that system's containers
ixora stack system stop    <id>
ixora stack system restart <id>
```

Calling these on an **external** ID hard-errors with a hint:

```
Error: system 'personal' is external (no local lifecycle).
External systems are URLs ixora targets but doesn't manage.
```

To "start" an external, start the AgentOS instance behind its URL using whatever mechanism owns it.

## system default

```bash
ixora stack system default               # show the current default
ixora stack system default dev           # set 'dev' as the default
ixora stack system default --clear       # unset
```

The default is used when **2+ systems are available** and `--system` is omitted. With 0 or 1 available, the default is irrelevant. `--system <id>` on any command always wins over the default.

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

## ixora-systems.yaml shape

```yaml
systems:
  - id: default
    name: 'Default'
    kind: managed
    mode: full

  - id: dev
    name: 'Development'
    kind: managed
    mode: custom

  - id: personal
    name: 'Personal local AgentOS'
    kind: external
    url: 'http://localhost:8080'

default: dev          # optional — set/cleared via `system default`
```

`mode` (managed only) is `full` or `custom`. Custom systems have a matching `~/.ixora/profiles/<id>.yaml` with the component list.

## Worked examples

### Add a managed prod system

```bash
ixora stack system add --kind managed --id prod --name "Production"
# prompts: host, port, user, password, mode (full/custom)

ixora stack system start prod                    # boots its containers
ixora stack system list                          # confirm it's running
ixora --system prod agents list                  # target prod for runtime ops
```

### Register an external local AgentOS

Suppose you have another AgentOS instance running on `:8080` from a different template. Register it for routing without giving ixora lifecycle responsibility:

```bash
ixora stack system add --kind external --id personal --url http://localhost:8080
ixora --system personal agents list              # runtime works
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

## Multi-system DB layout

By default each system gets its own `ai_<id>` Postgres database inside the **shared** `agentos-db` container. Sessions, memory, knowledge, and learnings are per-system isolated. To consolidate everything into one shared `ai` database:

```bash
ixora stack config set IXORA_DB_ISOLATION shared
ixora stack restart
```

A single-system deployment with the default `per-system` isolation just gets `ai_default` (no extra container). With 2+ systems, a one-shot `db-init` service provisions the additional databases on first boot.
