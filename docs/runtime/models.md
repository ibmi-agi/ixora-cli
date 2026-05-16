# `ixora models`

List the models the targeted AgentOS knows how to load.

> Not to be confused with [`ixora stack models show|set`](../stack/models.md), which manages the **provider** configuration for the local deployment. This page covers the **runtime** model registry.

```bash
ixora models list
```

---

## `list`

```bash
ixora models list
ixora models list --limit 50 --page 2
ixora models list --json
```

| Flag | Default | Purpose |
|---|---|---|
| `--limit <n>` | `20` | Page size |
| `--page <n>` | `1` | Page number |

Output columns: `ID`, `PROVIDER`.

Example:

```
$ ixora models list

┌──────────────────────────────────┬───────────┐
│ ID                               │ PROVIDER  │
├──────────────────────────────────┼───────────┤
│ anthropic:claude-sonnet-4-6      │ anthropic │
│ anthropic:claude-haiku-4-5       │ anthropic │
│ openai:gpt-4o                    │ openai    │
│ openai:gpt-4o-mini               │ openai    │
└──────────────────────────────────┴───────────┘
Page 1 of 1 — 4 results
```

Use these IDs in:

- `agents continue --model ...` (where supported)
- `evals run --model-id ...`
- `components create/update --config '{"model":"..."}'`
- The `IXORA_AGENT_MODEL` / `IXORA_TEAM_MODEL` env vars (set via [`stack models set`](../stack/models.md))

---

## See also

- [`../stack/models.md`](../stack/models.md) — switch the provider for the local deployment
- [`components.md`](components.md) — wire a specific model into a component
