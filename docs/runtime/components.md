# `ixora components`

Manage components — agents, teams, and workflows — as data objects on the AgentOS server.

> Distinct from [`ixora stack components list`](../stack/config.md#stack-components-list), which inspects the static manifest baked into the deployed image. This page covers the **runtime** component API.

```bash
ixora components list
ixora components get <component_id>
ixora components create --name ... --type agent|team|workflow [options]
ixora components update <component_id> [options]
ixora components delete <component_id>

# Nested config versioning
ixora components config list <component_id>
ixora components config create <component_id> --config '<json>'
ixora components config update <component_id> <version> --config '<json>'
ixora components config delete <component_id> <version>
```

---

## `list`

```bash
ixora components list
ixora components list --type agent
ixora components list --json id,name,component_type,stage
```

| Flag | Purpose |
|---|---|
| `--type <t>` | Filter by type: `agent`, `team`, `workflow` |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |

Output columns: `ID`, `NAME`, `TYPE`, `STAGE`.

`STAGE` reflects publishing state — typically `draft` or `published`.

---

## `get <component_id>`

```bash
ixora components get cmp_abc
ixora components get cmp_abc --json
```

Default fields: `ID`, `Name`, `Type`, `Description`, `Stage`, `Created`.

---

## `create`

```bash
ixora components create --name "QSYS Audit Agent" --type agent \
  --description "Audits job logs and storage" \
  --config '{"model":"anthropic:claude-sonnet-4-6","tools":["db.query"]}'
```

| Flag | Required | Purpose |
|---|---|---|
| `--name <name>` | yes | Display name |
| `--type <t>` | yes | `agent`, `team`, or `workflow` |
| `--description <desc>` | no | Free-form description |
| `--config <json>` | no | Initial configuration |
| `--stage <stage>` | no | `draft` or `published` |

Invalid JSON for `--config` errors client-side.

---

## `update <component_id>`

```bash
ixora components update cmp_abc --name "QSYS Audit Agent v2"
ixora components update cmp_abc --config '{"model":"openai:gpt-4o"}'
ixora components update cmp_abc --stage published
```

| Flag | Purpose |
|---|---|
| `--name <name>` | New display name |
| `--type <t>` | Change component type |
| `--description <desc>` | Update description |
| `--config <json>` | Replace configuration |
| `--stage <stage>` | Promote to `published` (or back to `draft`) |

Only supplied flags are mutated.

---

## `delete <component_id>`

```bash
ixora components delete cmp_abc
```

---

## Config versioning — `components config ...`

Each component has a versioned configuration history.

### `config list <component_id>`

```bash
ixora components config list cmp_abc
ixora components config list cmp_abc --json
```

Output columns: `VERSION`, `STATUS`, `CREATED_AT`.

### `config create <component_id>`

Create a new configuration version.

```bash
ixora components config create cmp_abc --config '{"model":"openai:gpt-4o"}'
```

| Flag | Required | Purpose |
|---|---|---|
| `--config <json>` | yes | Configuration as JSON |

### `config update <component_id> <version>`

Update a **draft** configuration version. Published versions are immutable.

```bash
ixora components config update cmp_abc 3 --config '{"model":"openai:gpt-4o-mini"}'
```

### `config delete <component_id> <version>`

```bash
ixora components config delete cmp_abc 2
```

---

## See also

- [`../stack/config.md`](../stack/config.md#stack-components-list) — `ixora stack components list`: discover what the deployed image declares
- [`registries.md`](registries.md) — versioned registry entries
- [`status.md`](status.md) — point-in-time list of agents/teams/workflows on the server
