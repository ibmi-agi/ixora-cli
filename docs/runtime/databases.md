# `ixora databases`

Database administration.

```bash
ixora databases migrate <db_id>
```

---

## `migrate <db_id>`

Run pending migrations on a specific database.

```bash
ixora databases migrate ai_default
ixora databases migrate ai_prod --target-version 12
```

| Flag | Purpose |
|---|---|
| `--target-version <v>` | Migrate up to a specific version. Omit to apply all pending migrations. |

On success: `✓ Database migration complete.`

---

## When to run this

- After upgrading ixora to a version that introduces new schema. `ixora stack upgrade` usually triggers migrations automatically as the API container starts, but `databases migrate` lets you run them out-of-band — useful in CI, or for debugging.
- After manually creating a new `ai_<id>` database (e.g. when retrofitting an existing deployment with per-system DB isolation).

Check current schema status against the API:

```bash
ixora docs show migrationsApi              # if your AgentOS exposes one
ixora status                               # shows the databases list
```

---

## See also

- [`../configuration.md#per-system-database-isolation-default`](../configuration.md) — per-system DBs vs shared
- [`status.md`](status.md) — list databases the AgentOS knows about
