# `ixora evals`

Manage eval runs — automated correctness/performance tests over agents and teams.

```bash
ixora evals list
ixora evals get <eval_run_id>
ixora evals run --agent-id <id>|--team-id <id> --eval-type <t> --input "..." [...]
ixora evals delete --ids id1,id2
```

All subcommands accept `--db-id <id>`.

---

## Eval types

| Type | What it measures | Required extra flag |
|---|---|---|
| `accuracy` | Output matches an expected string | `--expected-output "..."` |
| `agent_as_judge` | Another agent judges the output against criteria | `--criteria "..."` |
| `performance` | Latency / throughput | none |
| `reliability` | Specific tools were called | `--expected-tool-calls "tool1,tool2"` |

---

## `list`

```bash
ixora evals list
ixora evals list --agent-id sql-agent --type accuracy
ixora evals list --json id,name,eval_type
```

| Flag | Purpose |
|---|---|
| `--agent-id <id>` | Filter |
| `--team-id <id>` | Filter |
| `--workflow-id <id>` | Filter |
| `--model-id <id>` | Filter by model used |
| `--type <t>` | Filter by eval type |
| `--limit <n>` | Default `20` |
| `--page <n>` | Default `1` |
| `--sort-by <field>` | Sort field |
| `--sort-order asc\|desc` | Sort direction |
| `--db-id <id>` | Database ID |

Output columns: `ID`, `NAME`, `EVAL_TYPE`, `AGENT_ID`, `CREATED_AT`.

---

## `get <eval_run_id>`

```bash
ixora evals get er_abc
ixora evals get er_abc --json
```

Default fields: `ID`, `Name`, `Eval Type`, `Agent ID`, `Input`, `Output`, `Expected Output`, `Score`, `Created At`.

| Flag | Purpose |
|---|---|
| `--db-id <id>` | Database ID |

---

## `run`

Create and execute an eval synchronously. LLM-judge evals can take 30+ seconds.

```bash
# Accuracy
ixora evals run --agent-id sql-agent --eval-type accuracy \
  --input "What is 2+2?" --expected-output "4"

# Agent-as-judge
ixora evals run --agent-id sql-agent --eval-type agent_as_judge \
  --input "Summarize today's job logs" \
  --criteria "Must mention at least three jobs and identify any failures"

# Reliability
ixora evals run --agent-id sql-agent --eval-type reliability \
  --input "Look up the largest table" \
  --expected-tool-calls "db.query,db.describe_table"

# Performance with numeric scoring
ixora evals run --team-id security-team --eval-type performance \
  --input "Run a quick audit" \
  --scoring-strategy numeric --threshold 7 --warmup-runs 2
```

### Required flags

| Flag | Notes |
|---|---|
| Exactly one of `--agent-id <id>` / `--team-id <id>` | The CLI errors if both or neither is provided. |
| `--eval-type <t>` | `accuracy`, `agent_as_judge`, `performance`, or `reliability`. |
| `--input <text>` | Prompt to evaluate. |

### Type-specific required flags

| `--eval-type` | Also required |
|---|---|
| `accuracy` | `--expected-output <text>` |
| `agent_as_judge` | `--criteria <text>` |
| `reliability` | `--expected-tool-calls <csv>` |

### Optional flags

| Flag | Default | Purpose |
|---|---|---|
| `--model-id <id>` | server default | Model used for the eval |
| `--model-provider <name>` | — | Provider hint |
| `--scoring-strategy <s>` | `binary` | `binary` or `numeric` |
| `--threshold <n>` | — | Score threshold (1–10) — only with `numeric` scoring |
| `--warmup-runs <n>` | — | Warmup runs before measurement (useful for `performance`) |
| `--db-id <id>` | — | Database ID |

Result fields: `ID`, `Name`, `Eval Type`, `Agent ID`, `Team ID`, `Model ID`, `Eval Status`, `Score`, `Passed Tool Calls`, `Failed Tool Calls`, `Created At`.

---

## `delete`

```bash
ixora evals delete --ids er_a,er_b,er_c
```

| Flag | Required | Purpose |
|---|---|---|
| `--ids <csv>` | yes | Comma-separated eval run IDs |
| `--db-id <id>` | no | Database ID |

---

## See also

- [`agents.md`](agents.md) — manual runs (an eval is a structured one-off run)
- [`metrics.md`](metrics.md) — aggregated metrics over many runs
