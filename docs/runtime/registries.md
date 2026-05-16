# `ixora registries`

List entries from the AgentOS registry — typically versioned references to agents, teams, workflows, and other resources.

```bash
ixora registries list [--type <t>] [--name <n>]
```

---

## `list`

```bash
ixora registries list
ixora registries list --type agent
ixora registries list --name sql-agent --json
```

| Flag | Purpose |
|---|---|
| `--type <t>` | Filter by resource type (e.g. `agent`, `team`, `workflow`) |
| `--name <n>` | Filter by name |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |

Output columns: `ID`, `NAME`, `TYPE`, `VERSION`.

The registry is typically used to track published versions of components — distinct from the live components on the system (see [`components.md`](components.md)).

---

## See also

- [`components.md`](components.md) — currently-loaded components on the system
- [`status.md`](status.md) — point-in-time resource overview
