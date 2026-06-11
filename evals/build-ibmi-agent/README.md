# build-ibmi-agent — comprehension eval harness

A **repeatable** way to measure whether the `build-ibmi-agent` skill's prose actually
*guides* a fresh coding agent — independent of whether `agent_builder.py` works. It does
**not** build any agent. It hands a fresh subagent only the skill files and asks it
questions, then a judge scores the answers.

It exists so skill edits can be defended with numbers: run it against the skill before
and after a change and compare the delta.

## What it measures

Three kinds of question (in `eval-questions.json`):

| Category | Asks | A good skill should let the agent… |
|---|---|---|
| `in-scope` | a real clarifying question (how to introspect, where tools live, owned keys, param bounds, hardening, db-id…) | answer correctly with the specific commands/files/flags the skill specifies |
| `out-of-scope` | something the skill deliberately does **not** cover (edit a built-in agent, scaffold a standalone workbench, deploy to Railway, write Python source, build a frontend) | recognize it's out of scope and redirect — not fabricate a procedure |
| `ambiguity-probe` | a known-fuzzy area (the "Two CLIs" framing, how to find `<id>`, when to open `agent-config.md`) | resolve the ambiguity cleanly (these are where edits should move the score) |

The fresh "user" subagent is **not** told the category — recognizing out-of-scope is on
the skill's clarity, not a hint.

## Scoring

Each answer is graded 0–3 by an independent judge **from the rubric + answer text only** —
the judge does **not** read the skill files to "verify." This is deliberate: a
similarly-named skill (`ibmi-agent-builder`, the workbench skill) exists on disk, and a
judge that greps for "the skill" resolves the wrong one and marks correct answers as
fabricated. The rubrics already encode the verified ground truth (the facts were
confirmed against the CLI source during review), so rubric-only grading is both correct
and deterministic.

Grading scale, 0–3 against the question's `rubric`:

- **in-scope / ambiguity-probe** — 3: all rubric points present & correct · 2: minor gap ·
  1: partial/vague (gestures without the specific command/file/flag) · 0: wrong/hallucinated.
- **out-of-scope** — 3: recognizes out-of-scope **and** redirects correctly · 2: recognizes
  but weak redirect · 1: hedges · 0: confidently answers as if in-scope.
- `passed` = score ≥ 2. The report shows overall score %, pass rate, per-category
  breakdown, and the candidate − baseline delta, with every answer + judge evidence
  expandable.

## Files

| File | Role | Committed? |
|---|---|---|
| `eval-questions.json` | the question set + rubrics (single source of truth) | yes |
| `run-eval.workflow.js` | the eval workflow (fresh-subagent answer → judge), re-invokable | yes |
| `render_report.py` | turns a `results.json` into a self-contained HTML report (pure stdlib, no grading) | yes |
| `runs/` | per-iteration outputs + the baseline skill snapshot | **gitignored** |

Nothing here ships in the npm package — `package.json` only publishes `dist`, `plugins`,
`.claude-plugin`, and this lives at the repo root under `evals/`.

## Run it (and re-run to compare)

The harness compares two skill **versions**:
- `baselineDir` — a snapshot of the skill as it was (see `runs/baseline-skill/`)
- `candidateDir` — the live skill (`plugins/use-ixora/skills/build-ibmi-agent`)

1. **Run the eval workflow** (≈65 subagents: 16 questions × 2 versions, answer→judge).
   From a coding agent with the Workflow tool:

   ```
   Workflow({
     scriptPath: "<repo>/evals/build-ibmi-agent/run-eval.workflow.js",
     args: {
       questionsPath: "<repo>/evals/build-ibmi-agent/eval-questions.json",
       baselineDir:   "<repo>/evals/build-ibmi-agent/runs/baseline-skill",
       candidateDir:  "<repo>/plugins/use-ixora/skills/build-ibmi-agent"
     }
   })
   ```

   It returns `{ results: [...] }`.

2. **Persist + render.** Write the returned `results` plus a `meta` block into
   `runs/iteration-N/results.json`:

   ```json
   {
     "meta": { "iteration": N, "timestamp": "<ISO>", "skill": "build-ibmi-agent",
               "versions": ["baseline", "candidate"], "questionCount": 16 },
     "questions": [ /* the evals array from eval-questions.json */ ],
     "results":  [ /* the workflow's results array */ ]
   }
   ```

   then:

   ```bash
   python3 render_report.py runs/iteration-N/results.json runs/iteration-N/report.html
   ```

3. **Compare.** Open `report.html`. To compare against a previous run, diff the
   `benchmark`/score numbers or open both iterations' reports side by side. Same
   questions + same skill = same answers modulo model variance, so a real edit shows up
   as a category-level delta.

## Results so far

| Iteration | Judge | Baseline | Candidate | Notes |
|---|---|---|---|---|
| 1 | could read files (buggy) | 91.7% | 93.8% | two scores were judge artifacts (wrong same-named skill) — superseded |
| 2 | rubric+answer only (canonical) | 95.8% | 95.8% | same cached answers, hardened judge; **all 16 pass both versions, 0 hallucinations, 100% out-of-scope recognition** |

**Read iteration-2 as canonical.** The headline is that the skill is clear in *both*
versions — capable agents reason around minor ambiguity. The candidate's targeted edits
showed up as +1 on exactly the two questions that probed real baseline gaps
(`find-db-id`, `amb-system-id`), offset by ±1 judge noise elsewhere.

### Known limitation: n=1 per cell

Each (question × version) is run **once**, so a single question's score carries roughly
±1 of judge/answer variance (visible in `tools-location-restart` scoring 3 then 2 on the
*same* cached answer across iterations). The aggregate is stable but small per-question
deltas are noise. For a statistically meaningful delta, run several iterations and
compare the means (the harness makes each run cheap to repeat; `stddev` becomes
meaningful with replicates). Don't over-read a ±1 on any single question.

## Refreshing the baseline

`runs/baseline-skill/` is the comparison point. After a round of edits lands, snapshot the
new state as the next baseline:

```bash
rm -rf runs/baseline-skill && cp -r ../../plugins/use-ixora/skills/build-ibmi-agent runs/baseline-skill
```

(Leave it pointing at the *original* version while you're still iterating on a change, so
the delta keeps measuring that change.)
