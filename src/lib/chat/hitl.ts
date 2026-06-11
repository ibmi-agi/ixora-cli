import type { AgentStream, StreamEvent } from "@worksofadam/agentos-sdk";
import {
  buildConfirmPayload,
  buildRejectPayload,
} from "../agentos-background.js";

// HITL controller for `ixora chat`: pause -> stamp -> continue -> re-pause
// state machine (see the hitl_contract section of the API reference).
//
// Seam design: the controller OWNS the re-pause loop but NEVER iterates a
// stream itself. The caller injects:
//   - decide():            one prompt per requires_confirmation tool;
//   - continueRun():       the SDK continue call (agents today, teams later);
//   - reduceContinueStream(): consumes the continue stream with the caller's
//     own reducer and resolves with the NEXT captured pause, or null when the
//     run reached a terminal state (RunCompleted | RunError | RunCancelled).
// Keeping the loop here makes the two openagent defects impossible to
// reintroduce per call site:
//   (A) a RunPaused INSIDE a continue stream re-enters the confirm->continue
//       cycle (the while loop below) instead of being silently dropped;
//   (B) when ALL tools are rejected, continue is STILL sent with the stamped
//       confirmed:false + confirmation_note — never strand a paused run.

/**
 * Wire shape of a pending HITL tool execution (RunPaused `tools[]` entries and
 * `requirements[].tool_execution`). `confirmed`/`confirmation_note` start null
 * and are stamped client-side before continue. The index signature preserves
 * unknown wire fields so they round-trip untouched.
 */
export interface ToolExecution {
  tool_call_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  requires_confirmation: boolean;
  confirmed: boolean | null;
  confirmation_note: string | null;
  [key: string]: unknown;
}

/** RunPaused top-level `requirements[]` entry (wire-only, not in the SDK types). */
export interface PauseRequirement {
  id: string;
  created_at: string;
  tool_execution: ToolExecution;
  [key: string]: unknown;
}

/** A captured RunPaused, normalized for the controller. */
export interface CapturedPause {
  runId: string;
  /** null when unknown — NEVER an empty string. */
  sessionId: string | null;
  /** Agent or team id (informational; `continueRun` closes over the target). */
  entityId: string;
  /** Authoritative shape when non-empty. */
  requirements: PauseRequirement[];
  /** Fallback shape when `requirements` is absent/empty. */
  tools: ToolExecution[];
}

/** Outcome of prompting the user for one tool execution. */
export interface HitlDecision {
  approve: boolean;
  /** Why the tool was rejected — stamped into `confirmation_note`. */
  note?: string;
}

/** Injected prompt: called once per `requires_confirmation` tool. */
export type DecideToolFn = (
  toolExecution: ToolExecution,
) => Promise<HitlDecision>;

export interface ContinueRunOptions {
  /** JSON string of the FULL stamped tool_execution array. */
  tools: string;
  /** Omitted entirely when unknown — never sent as ''. */
  sessionId?: string;
  stream?: boolean;
}

/**
 * Injected continue call. Mirrors the SDK's
 * `client.agents.continue(agentId, runId, options)` (teams are identical) so
 * the caller binds the entity once and the controller stays entity-agnostic.
 */
export type ContinueRunFn = (
  runId: string,
  options: ContinueRunOptions,
) => Promise<AgentStream | unknown>;

/**
 * Injected stream reduction: consume the continue stream (the caller's
 * reducer/renderer owns iteration) and resolve with the next captured pause,
 * or null once the run reached a terminal state.
 */
export type ReduceContinueStreamFn = (
  stream: AgentStream | unknown,
) => Promise<CapturedPause | null>;

export interface RunHitlLoopOptions {
  /** The initial captured pause (from the first RunPaused). */
  pause: CapturedPause;
  continueRun: ContinueRunFn;
  reduceContinueStream: ReduceContinueStreamFn;
  /** Required unless `autoApprove` is set. */
  decide?: DecideToolFn;
  /** `--bypass-confirmations`: no prompts, stamp everything confirmed:true. */
  autoApprove?: boolean;
}

export interface HitlLoopResult {
  /** Number of continue calls sent (= confirmation rounds resolved). */
  rounds: number;
  /** Tools stamped confirmed:true without prompting (autoApprove mode). */
  autoApproved: number;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolExecution(value: unknown): value is ToolExecution {
  return (
    isRecord(value) &&
    typeof value.tool_call_id === "string" &&
    typeof value.tool_name === "string"
  );
}

function isRequirement(value: unknown): value is PauseRequirement {
  return isRecord(value) && isToolExecution(value.tool_execution);
}

/** Context the caller captured before the pause (RunStarted fields). */
export interface PauseContext {
  entityId: string;
  /** run_id captured at RunStarted (fallback when the event lacks one). */
  runId?: string | null;
  /** session_id captured at RunStarted — preferred over the event's. */
  sessionId?: string | null;
}

/**
 * Normalize a RunPaused/TeamRunPaused StreamEvent into a CapturedPause.
 * `requirements` is read through the StreamEvent index signature (it is not in
 * the SDK RunPausedEvent type); `tools` is kept as the fallback shape.
 * session_id precedence: captured-at-RunStarted, then the event's own — empty
 * strings are treated as missing so '' can never reach a continue call.
 */
export function capturePause(
  event: StreamEvent,
  context: PauseContext,
): CapturedPause {
  const runId = nonEmptyString(event.run_id) ?? nonEmptyString(context.runId);
  if (!runId) {
    throw new Error(
      "RunPaused event carried no run_id and none was captured at RunStarted",
    );
  }
  const rawRequirements = event["requirements"];
  const requirements = Array.isArray(rawRequirements)
    ? rawRequirements.filter(isRequirement)
    : [];
  const rawTools = event["tools"];
  const tools = Array.isArray(rawTools) ? rawTools.filter(isToolExecution) : [];
  return {
    runId,
    sessionId:
      nonEmptyString(context.sessionId) ??
      nonEmptyString(event["session_id"]) ??
      null,
    entityId: context.entityId,
    requirements,
    tools,
  };
}

/**
 * The tool executions to prompt for / send back: `requirements[]` is
 * authoritative; `tools[]` is the fallback when requirements is absent/empty.
 */
export function pendingToolExecutions(pause: CapturedPause): ToolExecution[] {
  if (pause.requirements.length > 0) {
    return pause.requirements.map((r) => r.tool_execution);
  }
  return pause.tools;
}

/**
 * Serialize the stamped tool_execution array for one continue call. Reuses
 * buildConfirmPayload/buildRejectPayload when the uniform all-approve /
 * all-reject shapes fit; stamps per tool for mixed decisions. Entries without
 * `requires_confirmation: true` (or without a recorded decision) round-trip
 * untouched.
 */
export function buildDecisionPayload(
  toolExecutions: ToolExecution[],
  decisions: ReadonlyMap<string, HitlDecision>,
): string {
  const decided = toolExecutions
    .map((te) => decisions.get(te.tool_call_id))
    .filter((d): d is HitlDecision => d !== undefined);
  const uniform =
    decided.length === toolExecutions.length &&
    toolExecutions.every((te) => te.requires_confirmation === true);
  if (uniform && decided.every((d) => d.approve)) {
    return buildConfirmPayload(toolExecutions);
  }
  const notes = new Set(decided.map((d) => d.note));
  if (uniform && decided.every((d) => !d.approve) && notes.size === 1) {
    return buildRejectPayload(toolExecutions, decided[0]?.note);
  }
  return JSON.stringify(
    toolExecutions.map((te) => {
      const decision =
        te.requires_confirmation === true
          ? decisions.get(te.tool_call_id)
          : undefined;
      if (!decision) return te;
      return decision.approve
        ? { ...te, confirmed: true }
        : {
            ...te,
            confirmed: false,
            // Same default note buildRejectPayload stamps.
            confirmation_note: decision.note ?? "Rejected via CLI",
          };
    }),
  );
}

/**
 * Drive the full HITL cycle from a captured pause to a terminal state:
 * prompt (or auto-approve) -> stamp -> continue -> reduce -> repeat on
 * re-pause. run_id and session_id are INVARIANT across rounds: the values from
 * the first capture are reused verbatim for every continue (a session_id is
 * adopted from a later pause only if none was known yet). Continue is ALWAYS
 * sent — even when every tool was rejected — so the run never strands paused
 * server-side.
 */
export async function runHitlLoop(
  options: RunHitlLoopOptions,
): Promise<HitlLoopResult> {
  const { continueRun, reduceContinueStream } = options;
  const mode = options.autoApprove
    ? ({ kind: "auto" } as const)
    : options.decide
      ? ({ kind: "prompt", decide: options.decide } as const)
      : undefined;
  if (!mode) {
    throw new Error(
      "runHitlLoop requires a decide() function unless autoApprove is set",
    );
  }

  const runId = options.pause.runId;
  let sessionId = options.pause.sessionId;
  let pause: CapturedPause | null = options.pause;
  let rounds = 0;
  let autoApproved = 0;

  while (pause) {
    if (!sessionId) sessionId = nonEmptyString(pause.sessionId) ?? null;
    const toolExecutions = pendingToolExecutions(pause);

    let tools: string;
    if (mode.kind === "auto") {
      // Stamp ONLY confirmation-gated entries (contract: everything else —
      // user-input/approval requirements — round-trips untouched).
      const decisions = new Map<string, HitlDecision>(
        toolExecutions
          .filter((te) => te.requires_confirmation === true)
          .map((te) => [te.tool_call_id, { approve: true }]),
      );
      tools = buildDecisionPayload(toolExecutions, decisions);
      autoApproved += decisions.size;
    } else {
      const decisions = new Map<string, HitlDecision>();
      for (const toolExecution of toolExecutions) {
        if (toolExecution.requires_confirmation !== true) continue;
        decisions.set(
          toolExecution.tool_call_id,
          await mode.decide(toolExecution),
        );
      }
      tools = buildDecisionPayload(toolExecutions, decisions);
    }

    const continueOptions: ContinueRunOptions = { tools, stream: true };
    if (sessionId) continueOptions.sessionId = sessionId;
    const stream = await continueRun(runId, continueOptions);
    rounds += 1;

    // Defect (A) fix: a RunPaused inside the continue stream yields a fresh
    // CapturedPause here and re-enters the loop with the same run/session.
    pause = await reduceContinueStream(stream);
  }

  return { rounds, autoApproved };
}
