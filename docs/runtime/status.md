# `ixora status`

AgentOS server resource overview — databases, agents, teams, workflows, knowledge bases, and exposed HTTP interfaces.

```bash
ixora status
```

Single command, no subcommands. Accepts the standard global flags (`--system`, `--url`, `-o`, `--json`).

---

## Output

Default (table) rendering — multi-section dump driven by the `/config` endpoint:

```
$ ixora status

  OS ID         my-agentos
  Name          ixora
  Description   AI agent platform for IBM i

  DATABASES (2)
    - ai_default (primary)
    - postgres

  STORAGE
    Sessions   ai_default
    Metrics    ai_default
    Memory     ai_default
    Knowledge  ai_default
    Evals      ai_default
    Traces     ai_default

  AGENTS (3)
    ID         NAME             DB           DESCRIPTION
    sql-agent  SQL Services     ai_default   Db2 for i queries and monitoring
    sec-agent  Security Auditor ai_default   System security assessments
    kb-agent   Knowledge        ai_default   Retrieve docs from the knowledge base

  TEAMS (1)
    ID             NAME            MODE      DB           DESCRIPTION
    security-team  Security Team   collab    ai_default   Multi-agent audit

  WORKFLOWS (1)
    ID                     NAME              DB           DESCRIPTION
    security-assessment    Security Audit    ai_default   Run a full assessment

  KNOWLEDGE (1)
    ID         NAME           DB           TABLE
    main       Main KB        ai_default   knowledge_vectors

  INTERFACES (2)
    TYPE    VERSION   ROUTE
    rest    1         /v1
    mcp     —         /mcp
```

The JSON form (`--json`) emits the raw `/config` payload — the cleanest way to programmatically discover what the server exposes.

---

## When to use it

- After install: confirm the agents you expected are loaded.
- After `ixora stack restart`: verify the system came back with the right components.
- When wiring an external tool (UI, control plane, CI): grab the database IDs, interfaces, and component IDs.
- When debugging: cross-reference what the API thinks is loaded with `ixora stack components list` (what the *image* declares).

---

## See also

- [`health.md`](health.md) — just the uptime + latency, no resource detail
- [`../stack/config.md#stack-components-list`](../stack/config.md#stack-components-list) — components in the image
- [`docs.md`](docs.md) — full HTTP API surface
