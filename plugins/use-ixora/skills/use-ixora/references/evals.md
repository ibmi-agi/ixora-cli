# Evals — `ixora evals`

> Canonical flag reference: [`../docs/runtime/evals.md`](../docs/runtime/evals.md). This page covers the type-conditional flag matrix, the synchronous-blocking behavior, and where to find per-iteration scores in the response.

`ixora evals` creates and inspects eval runs against agents or teams. Verbs: `list`, `get`, `run`, `delete`. Each targets the resolved system (`--url <url>` bypasses resolution; `--system <id>` picks one).

There is no `update` verb — the SDK and server both support renaming an eval run, but the CLI does not surface it.

---

## evals list

```bash
ixora evals list                            # paginated, newest first
ixora evals list --agent-id sql-agent       # filter by component
ixora evals list --type reliability --limit 50
ixora evals list --json id,name,eval_type,agent_id,created_at | jq .
```

Filter flags: `--agent-id`, `--team-id`, `--workflow-id`, `--model-id`, `--type <accuracy|agent_as_judge|performance|reliability>`. Pagination: `--limit`, `--page`. Sort: `--sort-by`, `--sort-order`. Multi-database: `--db-id`.

Output columns: `ID`, `NAME`, `EVAL_TYPE`, `AGENT_ID`, `CREATED_AT`.

---

## evals get

```bash
ixora evals get <eval_run_id>               # table view of the headline fields
ixora evals get <eval_run_id> --json        # full eval_data + eval_input
```

Default fields: `ID`, `Name`, `Eval Type`, `Agent ID`, `Input`, `Output`, `Expected Output`, `Score`, `Created At`.

Where the actual scores live in the JSON form:

| Eval type | Score location |
|---|---|
| `accuracy` | `eval_data.results[].score`, with `.reason` for each judge call; aggregate at `eval_data.avg_score` |
| `agent_as_judge` | `eval_data.results[].score` + `.reason`; `eval_data.eval_status` summarizes |
| `reliability` | `eval_data.passed_tool_calls` / `eval_data.failed_tool_calls`; `eval_data.eval_status` |
| `performance` | `eval_data.timings` (per-run latencies); no scores |

---

## evals run — create + execute synchronously

The eval blocks until the agent/team finishes and (for `accuracy` / `agent_as_judge`) until the judge model returns a score. **LLM-judged evals can take 30–120s.** No streaming form exists.

Always required: `--eval-type`, `--input`, and exactly one of `--agent-id` / `--team-id`.

Type-conditional required flags (CLI rejects mismatches before any HTTP call):

| eval-type        | also requires                            |
| ---------------- | ---------------------------------------- |
| `accuracy`       | `--expected-output <text>`               |
| `agent_as_judge` | `--criteria <text>`                      |
| `reliability`    | `--expected-tool-calls <a,b,c>` (csv)    |
| `performance`    | nothing extra — pure latency measurement |

Optional everywhere: `--model-id`, `--model-provider`, `--scoring-strategy <numeric|binary>`, `--threshold <1-10>`, `--warmup-runs <n>`, `--db-id`.

```bash
# Accuracy: response must match (or closely match) the expected string
ixora evals run --agent-id sql-agent --eval-type accuracy \
  --input "what is 2 plus 2" --expected-output "4"

# Agent-as-judge: another LLM scores the response against your criteria
ixora evals run --agent-id sql-agent --eval-type agent_as_judge \
  --input "summarize what an LPAR is in one sentence" \
  --criteria "Concise (≤1 sentence), accurate, no marketing fluff" \
  --scoring-strategy numeric --threshold 7

# Reliability: agent must call the exact tools you expect
ixora evals run --agent-id sql-agent --eval-type reliability \
  --input "show me the top 5 CPU-hungry jobs" \
  --expected-tool-calls "run_sql,format_results"

# Performance: just timings; no expected output
ixora evals run --agent-id sql-agent --eval-type performance \
  --input "what's the current QSYS library version?" \
  --warmup-runs 1

# Team eval
ixora evals run --team-id security-team --eval-type accuracy \
  --input "..." --expected-output "..."

# Project specific fields for scripting
ixora evals run ... --json id,eval_data | jq '.eval_data.results[].score'
```

---

## evals delete

```bash
ixora evals delete --ids id1,id2,id3        # comma-separated, no spaces required
ixora evals delete --ids $(ixora evals list --json id | jq -r '.data[].id' | paste -sd,)
```

---

## Gotchas

- **`evals run` blocks for the full duration.** LLM-judge runs can take 30–120s; performance/reliability are usually faster but still synchronous. No streaming form exists. Set generous `--timeout <seconds>` if your shell or HTTP client kills long requests.
- **`--agent-id` and `--team-id` are mutually exclusive.** The CLI checks this before any HTTP call; the server will also reject combined values.
- **`--expected-tool-calls` is CSV, not repeated flag.** `--expected-tool-calls "multiply,add"` — not `--expected-tool-calls multiply --expected-tool-calls add`.
- **Accuracy evals don't populate `eval_data.eval_status`.** That field is for `reliability` / `agent_as_judge`. Accuracy scores live under `eval_data.results[].score` and `eval_data.avg_score`.
- **Need a field the table view drops?** Use `--json <fields>` projection — or `ixora docs show run_eval` to see the full server response shape. See [`docs.md`](docs.md).
- **`--threshold` is only meaningful with `--scoring-strategy numeric`.** Binary scoring (the default) ignores it.

---

## See also

- [`../docs/runtime/evals.md`](../docs/runtime/evals.md) — canonical command reference
- [`agents-teams-workflows.md`](agents-teams-workflows.md) — manual `run` (an eval is a structured one-off run)
- [`observability.md`](observability.md) — `ixora metrics get` for aggregate run counts
- [`docs.md`](docs.md) — `ixora docs show run_eval` for the full server schema
