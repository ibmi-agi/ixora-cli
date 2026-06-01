# SQL-tool YAML — authoring & validation

> `create-tool-yaml` validates against the bundled [`../assets/sql-tools-config.schema.json`](../assets/sql-tools-config.schema.json) (a snapshot of `ixora/tools/sql-tools-config.schema.json`) with the same `jsonschema` draft-07 validator the in-app builder uses. **Treat the validator as the source of truth** — write a draft, run it, fix what it reports. This page is just the shape and the non-obvious gotchas it catches.

A builder-made agent's custom SQL tools live in one `tools.yaml`: named, parameterized, **read-only** statements the agent calls by name. The agent always also has the fixed IBM i CLI toolkit (`validate_and_run_sql`, `list_schemas`, …; see [`agent-config.md`](agent-config.md)), so `tools.yaml` is for the *domain* queries.

## Shape

```yaml
tools:
  active_jobs:                     # lowercase; the name the agent calls
    source: default                # 'default' → the auto-injected sources block
    description: "What it returns and when to use it (the model reads this to pick it)"
    statement: |
      SELECT JOB_NAME, SUBSYSTEM, CPU_TIME
      FROM   TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => :subsystem))
      FETCH FIRST :limit ROWS ONLY
    parameters:                    # a LIST of objects
      - { name: subsystem, type: string,  required: true }
      - { name: limit,     type: integer, default: 50, min: 1, max: 500 }
    security:
      readOnly: true
```

You don't write the top-level `sources:` block — `create-tool-yaml` injects a default one (`${DB2i_HOST}` etc., expanded by the stack at run time) when it's absent.

## Gotchas the validator catches

- **`source: default` is a REQUIRED per-tool key** — distinct from the top-level `sources:` block you don't write. Every tool must set `source`; `default` points at the auto-injected block.
- **`parameters` is a LIST of objects**, not a mapping; each needs at least `name` + `type`.
- **Numeric bounds are `min`/`max`** — not `minimum`/`maximum`.
- **String/array bounds are `minLength`/`maxLength`** (camelCase — yes, inconsistent with `min`/`max`).
- **`type` is lowercase, one of `string|boolean|integer|float|array`.** `number` is invalid → use `integer`/`float`. `type: array` needs `itemType`.
- **`default` must match the declared type** (`50`, not `"50"`).
- **SQL placeholders are `:param_name`** and must match a declared parameter.

## Validate & write

```bash
uv run "$AB" create-tool-yaml --agent-id active-jobs --yaml-file ./tools.yaml --system <id>
# --emit-stdout to validate + print without writing; --yaml-file - to read stdin
```

- **Managed system:** writes `~/.ixora/user_tools/<agent_id>/tools.yaml` (bind-mounted into the API container), picked up at run time — no restart.
- **External / `--url`:** returns `written:false` + the rendered YAML (the host's `user_tools` path is unknown) — pass `--user-tools-dir`, deliver it out-of-band, or build a toolset-only agent.

`<agent_id>` is the YAML dir and the component-id prefix; it must be unique on the host (`user_tools/` is shared).

## See also

- [`agent-config.md`](agent-config.md) — wiring these tools into an agent
- [`endpoint-resolution.md`](endpoint-resolution.md) — how `--system` maps to the write path
