# Error-Message Triage

Four parallel pressure-test agents probed the live dev system on 2026-05-18.
Findings are grouped by **leverage** — how many commands a single code change
improves — and then by surface area. Source line numbers reference the
working tree at the time of the audit.

Status legend:
- 🐛 **bug** — silently wrong behavior (data integrity or invisible failure)
- 🩹 **fix** — message itself is wrong/misleading
- ✨ **polish** — message is correct but lacks an actionable next step

---

## Tier 0 — Real bugs (not just bad messages)

These deceive users and scripts: success exit codes on failures, silent
fallbacks, or invariant violations that leak as user-facing errors.

| ID  | Command                                          | Symptom                                                                                                              | Source                                                            |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| B1  | `ixora knowledge config`                         | 🐛 Crashes with `AgentOS context not initialised` — internal invariant leaks because `STACK_HINT_NAMES` matches by leaf name without checking the parent chain. | `src/cli.ts:184`, `src/lib/stack-hints.ts:21`                     |
| B2  | `ixora sessions delete <bogus-id>`               | 🐛 Prints `Success: Session deleted.` and exits 0 — the server is silent on misses. Data integrity risk for scripts.  | `src/agentos/sessions.ts:227-241`                                 |
| B3  | `ixora agents continue <agent> <bad-run> "[]" --session-id <x>` | 🐛 Server replies `status: "ERROR"` but `handleNonStreamRun` only checks `status: "paused"`, so output is printed and exit is 0. | `src/lib/agentos-stream.ts:468-540`                              |
| B4  | `ixora agents get ""` (and teams/workflows)      | 🐛 Empty-string positional satisfies the required arg, then list endpoint is hit. User thinks they got one agent, got the fleet. | `src/agentos/agents.ts:73`, `teams.ts:57`, `workflows.ts:59`      |
| B5  | `ixora stack components list --image bogus/x`    | 🐛 Header says "Components from bogus/x" but body is the cached manifest from the installed image. Active misinformation. | `src/commands/components.ts:29-31`                                |
| B6  | `ixora models list --limit=-1`                   | 🐛 Returns `meta: { limit: -1, total_pages: -2 }` exit 0. Only `models` paginates client-side without validation.    | `src/agentos/models.ts:25-50`                                     |
| B7  | `ixora stack start --image-version garbage`      | 🐛 Silently restarts the stack — option is only read by `install`/`upgrade` but accepted everywhere. Risk of unintended restart. | `src/cli.ts:214` (option), `src/commands/start.ts`               |
| B8  | `ixora stack start --mode bogus`                 | 🐛 Silently accepted and dropped. User thinks they switched mode.                                                    | `src/cli.ts:210-213`                                              |
| B9  | `ixora stack config set BAD.KEY value`           | 🐛 Writes an invalid env-var identifier into `~/.ixora/.env`; compose will choke later.                              | `src/commands/config.ts:187-195`, `src/lib/env.ts:132`            |
| B10 | `ixora components config list <bogus-component>` | 🐛 Returns `[]` exit 0 — script can't tell "no configs" from "no such component".                                    | `src/agentos/components.ts:244-279`                               |

---

## Tier 1 — Centralised handlers (one fix → many commands)

These changes touch a single location but improve every NotFoundError
surface, every validation surface, every connection-error message.

| ID  | Where                                  | Problem                                                                                                                                          | Proposed change                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | `src/lib/agentos-errors.ts:77-80`      | 🩹 `NotFoundError` → bare `${what} not found.`. No id echo, no discovery hint. Powers ~15 commands across agents/teams/workflows/sessions/traces/memories/schedules/approvals/evals. | Extend `ErrorContext` with `identifier?: string` and `listCommand?: string`. Emit: `${what} '${id}' not found. Run \`${listCommand}\` to see available IDs.` Update every `handleError(err, {…})` call site to pass them. |
| H2  | `src/lib/agentos-errors.ts:51`         | 🩹 `formatValidationError` produces lines like `- : Input should be a valid dictionary` because `loc.slice(1).join(".")` collapses to `""` when `loc` is `["body"]`. The `??` fallback never fires for empty strings. | `const raw = d.loc?.slice(1).join(".") ?? "";`<br>`const field = raw || d.loc?.[0] || "request body";`                                                                                                                                                                                                                              |
| H3  | `src/lib/agentos-errors.ts:90-94`      | 🩹 `InternalServerError` always exits 2 and tells the user to run `ixora stack status`. But the server frequently dresses 400-class errors as 500s with bodies like `404: No database found...` or `400: Invalid start_time format`. | Pattern-match the message: when it begins with `^\d{3}:\s`, re-route to the corresponding error branch (404 → NotFoundError, 400 → BadRequestError) so exit codes and hints match the real cause.                                                                                                |
| H4  | `src/lib/agentos-errors.ts:98-103`     | ✨ Connection-error hint always points at `ixora stack status`. When the user passed `--url`, that's the wrong diagnostic — stack status checks configured systems, not arbitrary URLs.                                | Add `viaOverrideUrl?: boolean` to `ErrorContext` (or detect from `ctx.url`). Swap the hint to `Verify the URL is reachable (e.g. \`curl ${url}/health\`).`                                                                                                                                                                                                                                                                                  |
| H5  | `src/lib/agentos-errors.ts:81-83`      | ✨ `BadRequestError` is a passthrough. Several common bodies are highly actionable if pattern-matched: `session_id is required` (→ tell about `--session-id`), `Available IDs: ['…']` (→ reformat the Python list as a CLI list with the right flag). | Add a small lookup table in `handleError` keyed by message-substring → reformatted hint. Keep the original `err.message` available behind `--debug`.                                                                                                                                                              |
| H6  | `src/index.ts` (root program)          | ✨ Commander's `error:` (lowercase) is inconsistent with our `Error:` (uppercase). Missing-arg / unknown-command errors give no list or "did you mean".                                                          | `program.showHelpAfterError(true)` plus `program.configureOutput({ outputError })` that normalises the prefix. Optionally add Levenshtein suggestions for unknown commands.                                                                                                                                       |

---

## Tier 2 — Per-command client-side validation

Every one of these currently round-trips to the server (or worse, silently
swallows the input). Reject locally with a clear message.

| ID  | Surface                                                                | Now                                                                       | Proposed                                                            |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| V1  | `--limit=-5`, `--limit=abc`, `--page=0`, `--page=abc` on every list    | Server-side 422 or silent garbage paging                                  | `Error: --limit must be a positive integer (got '-5').`             |
| V2  | `--user-id=` (empty string) on `sessions list`                         | Sends empty filter → empty result, exit 0                                  | `Error: --user-id was empty. Omit the flag to skip filtering.`      |
| V3  | `--last-event-index=abc` on `agents/teams/workflows resume`            | Server-side validation error                                              | `Error: --last-event-index must be a non-negative integer (got 'abc').` |
| V4  | `--start-time=garbage` / `--end-time=garbage` on `traces stats`        | Server-side `Invalid isoformat` masquerading as 500                       | `Error: --start-time 'garbage' is not a valid ISO 8601 timestamp.`  |
| V5  | `--status=garbage` on `approvals resolve`                              | SDK double-stringify bug → `Validation error: - : Input should be a valid dictionary` | `Error: --status must be one of: approved, rejected, expired, cancelled.` |
| V6  | `--type=bogus` on `components create/update`                           | Same garbled validation error                                             | `Error: Invalid --type 'bogus'. Allowed: agent, team, workflow.`    |
| V7  | `--image ''` on `stack components list`                                | Falls back to default silently                                            | `Error: --image requires a non-empty image reference.`              |
| V8  | `--image-version garbage`                                              | Accepted; pull fails downstream                                           | `Error: Invalid --image-version: garbage (expected vX.Y.Z, X.Y.Z, or 'latest').` |
| V9  | `knowledge upload /tmp` (directory)                                    | Server-side Python class repr leak                                        | `Error: /tmp is a directory, not a file. Upload a single file…`     |
| V10 | `<resource> update` with no fields (memories/schedules/components)     | `Validation error: - : Input should be a valid dictionary…`               | `Error: Nothing to update — pass at least one of --name, --description, ….` |

---

## Tier 3 — "Not found" plumbing for individual call sites

Once H1 lands, each of these call sites needs `identifier` + `listCommand`
passed through. The table tells the fixer what to put in each.

| Command                              | identifier source     | listCommand                                            |
| ------------------------------------ | --------------------- | ------------------------------------------------------ |
| `ixora agents get/run/cancel/resume` | first positional      | `ixora agents list`                                    |
| `ixora teams get/run/cancel/resume`  | first positional      | `ixora teams list`                                     |
| `ixora workflows get/run/cancel/resume` | first positional    | `ixora workflows list`                                 |
| `ixora sessions get`                 | `session_id`          | `ixora sessions list`                                  |
| `ixora traces get`                   | `trace_id`            | `ixora traces list`                                    |
| `ixora memories get`                 | `id`                  | `ixora memories list` (optional `--user-id`)          |
| `ixora schedules get`                | `id`                  | `ixora schedules list`                                 |
| `ixora approvals get`                | `id`                  | `ixora approvals list --status pending`                |
| `ixora evals get`                    | `eval_run_id`         | `ixora evals list`                                     |
| `ixora knowledge get` (content)      | content id            | `ixora knowledge list --db-id <db>`                    |
| `ixora metrics get --db-id <x>`      | `--db-id`             | (no list command — surface this honestly)              |
| `ixora stack system <start/stop/restart/remove/default> <id>` | positional id | `ixora stack system list`                              |
| `ixora stack config <show-system/reset/edit> <id>`            | positional id | `ixora stack system list`                              |
| `ixora stack agents <id>`            | positional id         | `ixora stack system list`                              |

---

## Tier 4 — Specific command improvements

| ID  | Command                                                  | Now                                                                              | Proposed                                                                                                                                                                                                          |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `ixora agents continue <bad-run-id>` (cache miss)        | `Pass agent_id explicitly: ixora agents continue <agent_id> <run_id>`           | Also point at `ixora agents pending` — the discovery tool for this exact case.                                                                                                                                  |
| S2  | `ixora agents continue <bad-run-id> --confirm`           | Same "pass agent_id" message — but `--confirm` needs the *cache*, not agent_id  | Branch the message: `--confirm/--reject need the cache; list paused runs with \`ixora agents pending\`.`                                                                                                       |
| S3  | `ixora agents continue <run-id> "hi"`                    | `Error: Provide tool results JSON, or use --confirm/--reject…` (no echo of how args were parsed) | Echo inferred shape: `Interpreted args as agent_id='X', run_id='hi'. Provide tool results JSON as a 3rd arg…`                                                                                                  |
| S4  | `ixora agents continue` (no args)                        | `Provide a run_id…`                                                              | Add: `List paused runs with \`ixora agents pending\`.`                                                                                                                                                            |
| S5  | `ixora traces delete <id>`                                | `error: unknown command 'delete'`                                                 | Register an explanatory handler: `traces` is read-only / immutable spans.                                                                                                                                          |
| S6  | `ixora databases <get|delete|update> <id>`               | `error: unknown command 'get'`                                                   | Either add the missing subcommands or list available ones with discovery hint.                                                                                                                                    |
| S7  | `ixora registries <get|delete|update>`                   | `error: unknown command 'get'`                                                   | Same.                                                                                                                                                                                                              |
| S8  | `ixora models` (no subcommand)                            | Prints help, exits 1                                                              | Default to `list` (or print help + exit 0 with one-line "Did you mean `ixora models list`?").                                                                                                                  |
| S9  | `ixora docs show /bogus/path`                             | Raw `No operation found for "/bogus/path"`, written via `cmd.error()` (no `Error:` prefix) | Route through `writeError`, add up-to-3 fuzzy-match suggestions, append `See all: ixora docs list`.                                                                                                            |
| S10 | `ixora knowledge get/delete/status <id>` w/ multi-KB     | Raw `db_id or knowledge_id query parameter is required… Available IDs: ['…']` (Python list repr) | Reformat in `BadRequestError` handler (H5): show available KBs as a bullet list with the right CLI flag name.                                                                                                    |
| S11 | `ixora knowledge get <content> --db-id <kb>` (real KB, bogus content) | `Knowledge base not found.` (misleading — KB exists, *content* doesn't)        | Per-call-site: pass `resource: "Knowledge content '${contentId}'"` + listCommand `ixora knowledge list --db-id <kb>`.                                                                                          |
| S12 | `ixora stack start/stop/restart/logs <bad-service>`      | `no such service: X` then `Error: Command failed: docker compose up -d X` + `Check ixora logs for details.` | Validate the service name against the compose file's service list pre-emptively; emit `Error: Unknown service 'X'. Valid: …. List with: ixora stack status.`                                                |
| S13 | Stack-hint shim (`ixora install`, `ixora restart`, …)    | `Hint: stack commands live under ixora stack.` then exits 1                      | Change `Hint:` → `Error:` (it *is* an error), pass the user's original argv through so the suggested command is paste-ready.                                                                                  |
| S14 | "Restart to apply" footers                                | Several commands print `ixora restart` (the deprecated bare form)               | Change to `ixora stack restart`; same for `ixora system restart` → `ixora stack system restart`.                                                                                                                |
| S15 | `--profile`/`--runtime`/`--kind` error wording           | Three styles: `Invalid --profile: X (choose: …)`, `Unknown runtime: X (choose: …)`, `Invalid --kind 'X'. Use 'a' or 'b'.` | Pick one house style — recommend `Error: Invalid --<flag>: <value> (choose: …)`.                                                                                                                              |

---

## Implementation plan

1. **Foundation (Tier 1).** Land H1–H6 first. Most of Tier 3 follows mechanically from H1.
2. **Per-call-site hints (Tier 3).** Sweep `src/agentos/*.ts` to add `identifier` + `listCommand` to every `handleError(err, {…})` call.
3. **Real bugs (Tier 0).** Fix B1 (parent-chain check), B2 (delete pre-check), B3 (`status: ERROR` branch in `handleNonStreamRun`), B4 (empty-id guard), B7/B8 (scope `--mode`/`--image-version` to install/upgrade).
4. **Validation (Tier 2).** Add per-command validators. These are mostly one-liners (the parser closure in each command).
5. **Specific improvements (Tier 4).** Small targeted fixes — can be done in any order.

Each tier is committable independently. Tier 1 + Tier 3 together is the
highest-leverage single PR and probably the right first cut.
