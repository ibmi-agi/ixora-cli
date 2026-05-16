# `ixora metrics`

Aggregated daily metrics across agents, teams, workflows, and users.

```bash
ixora metrics get [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
ixora metrics refresh
```

Both subcommands accept `--db-id <id>`.

---

## `get`

```bash
ixora metrics get
ixora metrics get --start-date 2026-05-01 --end-date 2026-05-15
ixora metrics get --start-date 2026-05-01 --json
```

| Flag | Format | Purpose |
|---|---|---|
| `--start-date <d>` | `YYYY-MM-DD` | Window start (inclusive) |
| `--end-date <d>` | `YYYY-MM-DD` | Window end (inclusive) |
| `--db-id <id>` | string | Database ID |

Output columns: `DATE`, `AGENT_RUNS`, `TEAM_RUNS`, `WORKFLOW_RUNS`, `USERS`.

Example:

```
$ ixora metrics get --start-date 2026-05-13 --end-date 2026-05-15

┌────────────┬────────────┬───────────┬───────────────┬───────┐
│ DATE       │ AGENT_RUNS │ TEAM_RUNS │ WORKFLOW_RUNS │ USERS │
├────────────┼────────────┼───────────┼───────────────┼───────┤
│ 2026-05-13 │ 142        │ 27        │ 4             │ 7     │
│ 2026-05-14 │ 168        │ 24        │ 5             │ 8     │
│ 2026-05-15 │  44        │  9        │ 0             │ 4     │
└────────────┴────────────┴───────────┴───────────────┴───────┘
```

---

## `refresh`

Trigger a server-side metrics rebuild — useful after backfilling traces or when daily aggregates look stale.

```bash
ixora metrics refresh
ixora metrics refresh --db-id ai_prod
```

Returns nothing on success beyond `✓ Metrics refresh triggered.`. The refresh runs asynchronously; re-run `metrics get` after a short pause to see updated numbers.

---

## See also

- [`traces.md`](traces.md) — per-run detail (higher granularity)
- [`status.md`](status.md) — current resource overview (point in time)
