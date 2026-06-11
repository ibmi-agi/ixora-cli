# Vendored assets — provenance & sync

These files are **snapshots** copied out of the Ixora platform repo so this skill
can run self-contained (no dependency on the Ixora Python source). They duplicate a
contract the Ixora app owns, so they can drift. Re-sync on release.

| File | Upstream source | Last synced |
|------|-----------------|-------------|
| `sql-tools-config.schema.json` | `ixora/tools/sql-tools-config.schema.json` | ixora @ `1b9a350` |

The agent-config contract (the `_IBMI_CLI_TOOLS` tool list, the `/components` config
shape, the protected keys) is duplicated in `../scripts/agent_builder.py` — its header
names the same upstream source (`ixora/agents/tools/builder.py`).

## Sync check

To confirm the schema snapshot is current:

```bash
diff sql-tools-config.schema.json /path/to/ixora/tools/sql-tools-config.schema.json
```

`../SKILL.md`'s **contract-drift diagnostic** (the last Gotcha — diff a skill-built config
via `ixora components get` against one from the in-app agent-builder agent, Ixora's
`AgentBuilderTools`) is the live guard against `agent_builder.py` drifting from `builder.py`.
