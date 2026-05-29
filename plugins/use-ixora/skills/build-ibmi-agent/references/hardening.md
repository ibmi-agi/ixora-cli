# Hardening loop — probe → judge → fix

> After registering, harden an agent autonomously: derive probes from its own instructions, run them against the live agent, judge from the trace, and apply **one** surgical edit per round. Borrowed from the workbench `ibmi-agent-builder` skill — it goes beyond what the in-app builder does.

`$AB` is the script (see [SKILL.md](../SKILL.md#preflight)); `$ID` the `component_id`, `$AGENT` the `agent_id`.

## 1. Probe (8–12, expected behavior noted for each)

| Bucket | ~n | Tests | Expected |
|---|---|---|---|
| Golden path | 3–5 | typical in-scope questions | correct answer, right named tool fires |
| Edge | 2–3 | ambiguous / boundary | asks to clarify, or admits it can't |
| Tool selection | 2–3 | something a specific named tool should answer | that tool fires, not ad-hoc SQL |
| Adversarial | 1–2 | injection, "modify the data", malformed | refuses; stays read-only |

## 2. Run & judge

```bash
RID=$(ixora agents run "$ID" "<probe>" --session-id probe-1 --bypass-confirmations --json | jq -r .run_id)
ixora traces get "$RID"     # span tree = ground truth: which tools fired, args, final answer
```

Mark PASS/FAIL on both axes: did the response match, and did the *right* tool fire? Judge on the trace, not the answer alone. (`--bypass-confirmations` is required or the run pauses on the SQL tools' confirmation gate.)

## 3. Fix — one lever per round

| Symptom | Lever |
|---|---|
| wrong behavior / tone / doesn't refuse | edit instructions → `update "$ID" --agent-id "$AGENT" --instructions-file …` |
| ad-hoc SQL when a named tool fits, or ignores a toolset | tighten instructions, or `update-scope … --toolsets …` |
| a tool's description/params confuse the model | rewrite `tools.yaml` → `create-tool-yaml`, then `update-scope` |
| history/memory off | `update … --options-json '{"num_history_runs":N}'` |
| model too weak (last resort) | `update "$ID" --agent-id "$AGENT" --model provider:model-id` |

Edits publish a new version immediately. Re-probe the failures plus a passing spot-check (edits can regress). **Cap ~5 rounds**; if a probe fails 3× on the same lever it's a tool gap or model limit, not a prompt fix.

## See also
- [`agent-config.md`](agent-config.md) — the `update` / `update-scope` contract
- `use-ixora` skill → `references/traces-sessions.md` — reading span trees
