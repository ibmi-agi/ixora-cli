// Pure event reducer for `ixora chat`.
//
// reduce(state, event) folds one SDK StreamEvent into a new TranscriptState —
// no TUI, no network, no mutation of the input (unchanged events return the
// SAME state reference, so callers can skip re-rendering). The mapping
// implements the full agent + team + workflow table from the chat API
// reference, including member attribution (delegate_task_to_member windows,
// agent_id-preferred routing), workflow step routing by step_id, HITL pause
// capture (requirements preferred, tools fallback), and the stream-end
// invariant (finalizeTranscript closes every open block exactly once).

import type { StreamEvent, ToolCallData } from "@worksofadam/agentos-sdk";
import type {
  AgentOSRequirement,
  AgentOSToolExecution,
  Block,
  GroupType,
  MemberBlock,
  Metrics,
  StepBlock,
  StepOutputSummary,
  TextBlock,
  ToolBlock,
  TranscriptState,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createInitialState(): TranscriptState {
  return {
    blocks: [],
    nextBlockSeq: 1,
    status: "idle",
    statusLine: null,
    runId: null,
    sessionId: null,
    agentId: null,
    teamId: null,
    workflowId: null,
    header: null,
    runCompleted: false,
    paused: null,
    metrics: null,
    memberResponses: null,
    error: null,
    openTextBlockId: null,
    currentMemberBlockId: null,
    workflowStack: [],
  };
}

export function reduce(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  switch (event.event) {
    // --- agent events (also nested member/workflow-executor events) ---
    case "RunStarted":
      return onRunStarted(state, event);
    case "RunContent":
      return onRunContent(state, event);
    case "RunContentCompleted":
      return onRunContentCompleted(state, event);
    case "ToolCallStarted":
      return onToolCallStarted(state, event);
    case "ToolCallCompleted":
      return onToolCallCompleted(state, event);
    case "RunCompleted":
      return onRunCompleted(state, event);
    case "RunError":
      return onRunError(state, event);
    case "RunPaused":
      return onRunPaused(state, event);
    case "RunContinued":
      return onRunContinued(state);
    case "RunCancelled":
      return onCancelled(state, event);
    case "ReasoningStarted":
    case "TeamReasoningStarted":
      return onReasoningStarted(state, event);
    case "ReasoningStep":
    case "TeamReasoningStep":
      return onReasoningStep(state, event);
    case "ReasoningCompleted":
    case "TeamReasoningCompleted":
      return onReasoningCompleted(state, event);

    // --- team events ---
    case "TeamRunStarted":
      return onTeamRunStarted(state, event);
    case "TeamRunContent":
      return onTeamRunContent(state, event);
    case "TeamRunContentCompleted":
      return onRunContentCompleted(state, event);
    case "TeamToolCallStarted":
      return onTeamToolCallStarted(state, event);
    case "TeamToolCallCompleted":
      return onTeamToolCallCompleted(state, event);
    case "TeamRunCompleted":
      return onRunCompleted(state, event);
    case "TeamRunError":
      return onRunError(state, event);
    case "TeamRunCancelled":
      return onCancelled(state, event);

    // --- workflow events ---
    case "WorkflowStarted":
      return onWorkflowStarted(state, event);
    case "WorkflowCompleted":
      return onWorkflowCompleted(state, event);
    case "WorkflowCancelled":
      return onCancelled(state, event);
    case "StepStarted":
      return onStepStarted(state, event);
    case "StepOutput":
      return onStepOutput(state, event);
    case "StepCompleted":
      return onStepCompleted(state, event);
    case "ParallelExecutionStarted":
      return onGroupStarted(state, event, "parallel");
    case "ConditionExecutionStarted":
      return onGroupStarted(state, event, "condition");
    case "LoopExecutionStarted":
      return onGroupStarted(state, event, "loop");
    case "RouterExecutionStarted":
      return onGroupStarted(state, event, "router");
    case "StepsExecutionStarted":
      return onGroupStarted(state, event, "steps");
    case "ParallelExecutionCompleted":
      return onGroupCompleted(state, event, "parallel");
    case "ConditionExecutionCompleted":
      return onGroupCompleted(state, event, "condition");
    case "LoopExecutionCompleted":
      return onGroupCompleted(state, event, "loop");
    case "RouterExecutionCompleted":
      return onGroupCompleted(state, event, "router");
    case "StepsExecutionCompleted":
      return onGroupCompleted(state, event, "steps");
    case "LoopIterationStarted":
    case "LoopIterationCompleted":
      return onLoopIteration(state, event);

    // --- known noise: status-line at most, safe to ignore ---
    // (PreHook*/PostHook*, UpdatingMemory, MemoryUpdate*, SessionSummary*,
    // ParserModel*, OutputModel*, CustomEvent, RunIntermediateContent, ...)
    // --- unknown events (wire-only ModelRequest*/ModelResponse*, future
    // additions): ignored silently for forward compatibility. ---
    default:
      return state;
  }
}

/**
 * Stream-end invariant: close every open block (text blocks trimEnd'd),
 * clear routing pointers. Idempotent — returns the SAME state reference when
 * there is nothing left to close, so it runs "exactly once".
 */
export function finalizeTranscript(state: TranscriptState): TranscriptState {
  const anythingOpen =
    state.blocks.some((b) => b.open) ||
    state.openTextBlockId !== null ||
    state.currentMemberBlockId !== null ||
    state.workflowStack.length > 0;
  if (!anythingOpen) return state;

  const draft = begin(state);
  for (const block of draft.blocks) {
    if (!block.open) continue;
    if (block.kind === "text") {
      patchBlock(draft, block.id, { open: false, text: block.text.trimEnd() });
    } else {
      patchBlock(draft, block.id, { open: false });
    }
  }
  draft.openTextBlockId = null;
  draft.currentMemberBlockId = null;
  draft.workflowStack = [];
  return draft;
}

/** `k=v` comma-joined args, values JSON-stringified, truncated to 50 chars. */
export function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${truncate(JSON.stringify(v) ?? "undefined", 50)}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Draft helpers (shallow-copied state; original is never mutated)
// ---------------------------------------------------------------------------

function begin(state: TranscriptState): TranscriptState {
  return {
    ...state,
    blocks: [...state.blocks],
    workflowStack: [...state.workflowStack],
    statusLine: null,
  };
}

function newId(draft: TranscriptState): string {
  const id = `b${draft.nextBlockSeq}`;
  draft.nextBlockSeq += 1;
  return id;
}

function getBlock(draft: TranscriptState, id: string): Block | undefined {
  return draft.blocks.find((b) => b.id === id);
}

function patchBlock(
  draft: TranscriptState,
  id: string,
  patch: Partial<Block>,
): void {
  const i = draft.blocks.findIndex((b) => b.id === id);
  if (i >= 0) {
    draft.blocks[i] = { ...draft.blocks[i], ...patch } as Block;
  }
}

function tsMs(event: StreamEvent): number {
  return event.created_at * 1000;
}

function str(event: StreamEvent, key: string): string | undefined {
  const v = event[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function getTool(event: StreamEvent): ToolCallData | undefined {
  const t = event.tool;
  return t && typeof t === "object" ? (t as ToolCallData) : undefined;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

// ---------------------------------------------------------------------------
// Block ops
// ---------------------------------------------------------------------------

function closeTextBlock(draft: TranscriptState): void {
  if (!draft.openTextBlockId) return;
  const block = getBlock(draft, draft.openTextBlockId);
  if (block && block.kind === "text") {
    patchBlock(draft, block.id, { open: false, text: block.text.trimEnd() });
  }
  draft.openTextBlockId = null;
}

function appendTextDelta(
  draft: TranscriptState,
  containerId: string | null,
  delta: string,
  atMs: number,
): void {
  if (draft.openTextBlockId) {
    const block = getBlock(draft, draft.openTextBlockId);
    if (block && block.kind === "text" && block.parentId === containerId) {
      patchBlock(draft, block.id, { text: block.text + delta });
      return;
    }
    closeTextBlock(draft);
  }
  const block: TextBlock = {
    id: newId(draft),
    kind: "text",
    parentId: containerId,
    open: true,
    createdAtMs: atMs,
    text: delta,
  };
  draft.blocks.push(block);
  draft.openTextBlockId = block.id;
}

function reasoningKey(draft: TranscriptState, event: StreamEvent): string {
  return `${str(event, "run_id") ?? draft.runId ?? "run"}:reasoning`;
}

function appendReasoning(
  draft: TranscriptState,
  containerId: string | null,
  key: string,
  delta: string,
  atMs: number,
): void {
  const existing = draft.blocks.find(
    (b) => b.kind === "reasoning" && b.key === key,
  );
  if (existing && existing.kind === "reasoning") {
    patchBlock(draft, existing.id, { text: existing.text + delta });
    return;
  }
  draft.blocks.push({
    id: newId(draft),
    kind: "reasoning",
    parentId: containerId,
    open: true,
    createdAtMs: atMs,
    key,
    text: delta,
  });
}

function startToolRow(
  draft: TranscriptState,
  containerId: string | null,
  tool: ToolCallData,
  atMs: number,
): void {
  closeTextBlock(draft); // text closes BEFORE a tool row appears
  const args = tool.tool_args ?? {};
  const block: ToolBlock = {
    id: newId(draft),
    kind: "tool",
    parentId: containerId,
    open: true,
    createdAtMs: atMs,
    toolCallId: tool.tool_call_id,
    toolName: tool.tool_name,
    args,
    argsSummary: summarizeArgs(args),
    status: "running",
    result: null,
    durationSeconds: null,
    startedAtMs: atMs,
  };
  draft.blocks.push(block);
}

function completeToolRow(
  draft: TranscriptState,
  tool: ToolCallData,
  atMs: number,
): void {
  // In-place completion keyed by tool_call_id (most recent row wins —
  // re-pause rounds always mint fresh ids, but be defensive).
  for (let i = draft.blocks.length - 1; i >= 0; i--) {
    const block = draft.blocks[i];
    if (block.kind === "tool" && block.toolCallId === tool.tool_call_id) {
      patchBlock(draft, block.id, {
        status: tool.tool_call_error ? "error" : "success",
        result: tool.result ?? null,
        durationSeconds:
          tool.metrics?.duration ?? (atMs - block.startedAtMs) / 1000,
        open: false,
      });
      return;
    }
  }
}

function openMemberBlocks(draft: TranscriptState): MemberBlock[] {
  return draft.blocks.filter(
    (b): b is MemberBlock => b.kind === "member" && b.open,
  );
}

function closeMemberBlock(draft: TranscriptState, blockId: string): void {
  closeTextBlock(draft); // flush the member's open text
  const block = getBlock(draft, blockId);
  if (block && block.kind === "member") {
    patchBlock(draft, blockId, {
      open: false,
      status: block.status === "error" ? "error" : "completed",
    });
  }
  if (draft.currentMemberBlockId === blockId) {
    draft.currentMemberBlockId = null;
  }
}

function openStepBlocks(draft: TranscriptState): StepBlock[] {
  return draft.blocks.filter(
    (b): b is StepBlock => b.kind === "step" && b.open,
  );
}

function sameStepIndex(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function formatStepIndex(
  index: number | [number, number] | null,
): string | null {
  if (index === null) return null;
  return Array.isArray(index) ? `${index[0]}.${index[1]}` : String(index);
}

/** Innermost still-open workflow container (group or step), if any. */
function innermostContainer(draft: TranscriptState): string | null {
  for (let i = draft.workflowStack.length - 1; i >= 0; i--) {
    const block = getBlock(draft, draft.workflowStack[i]);
    if (block?.open) return block.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routing: where does an un-prefixed agent event belong?
// ---------------------------------------------------------------------------

type Container =
  | { type: "top" }
  | { type: "member"; blockId: string }
  | { type: "step"; blockId: string };

function matchOpenStep(
  state: TranscriptState,
  event: StreamEvent,
): StepBlock | undefined {
  const steps = state.blocks.filter(
    (b): b is StepBlock => b.kind === "step" && b.open,
  );
  if (steps.length === 0) return undefined;
  const stepId = str(event, "step_id");
  const stepName = str(event, "step_name");
  const stepIndex = event.step_index;
  if (stepId) {
    const m = steps.find((b) => b.stepId === stepId);
    if (m) return m;
  }
  if (stepName) {
    const m = steps.find((b) => b.stepName === stepName);
    if (m) return m;
  }
  if (stepIndex !== undefined) {
    const m = steps.find((b) => sameStepIndex(b.stepIndex, stepIndex));
    if (m) return m;
  }
  // Workflow-tagged event with no exact match: innermost open step.
  if (stepId || stepName || stepIndex !== undefined || str(event, "workflow_id")) {
    return steps[steps.length - 1];
  }
  return undefined;
}

function matchOpenMember(
  state: TranscriptState,
  event: StreamEvent,
): MemberBlock | undefined {
  const open = state.blocks.filter(
    (b): b is MemberBlock => b.kind === "member" && b.open,
  );
  if (open.length === 0) return undefined;
  // Prefer agent_id routing (concurrent-delegation mitigation); positional
  // currentMember pointer is the fallback only.
  const agentId = str(event, "agent_id");
  if (agentId) {
    const m = open.find((b) => b.memberId === agentId);
    if (m) return m;
  }
  if (state.currentMemberBlockId) {
    const m = open.find((b) => b.id === state.currentMemberBlockId);
    if (m) return m;
  }
  return open[open.length - 1];
}

function resolveContainer(
  state: TranscriptState,
  event: StreamEvent,
): Container {
  const step = matchOpenStep(state, event);
  if (step) return { type: "step", blockId: step.id };
  const member = matchOpenMember(state, event);
  if (member) return { type: "member", blockId: member.id };
  return { type: "top" };
}

function containerId(container: Container): string | null {
  return container.type === "top" ? null : container.blockId;
}

// ---------------------------------------------------------------------------
// Agent event handlers
// ---------------------------------------------------------------------------

function onRunStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const container = resolveContainer(state, event);

  if (container.type === "member") {
    // UPGRADE the provisional member block: member_id arg may be a slug;
    // agent_id is canonical, agent_name is the display title.
    const draft = begin(state);
    const block = getBlock(draft, container.blockId);
    if (block && block.kind === "member") {
      patchBlock(draft, block.id, {
        name: str(event, "agent_name") ?? str(event, "agent_id") ?? block.name,
        memberId: str(event, "agent_id") ?? block.memberId,
      });
    }
    return draft;
  }

  if (container.type === "step") {
    const draft = begin(state);
    patchBlock(draft, container.blockId, {
      executorName:
        str(event, "agent_name") ??
        str(event, "agent_id") ??
        str(event, "team_name") ??
        str(event, "team_id") ??
        null,
    });
    return draft;
  }

  // Top-level run start: capture the continue/cancel keys + header.
  const draft = begin(state);
  draft.status = "running";
  draft.runCompleted = false;
  draft.paused = null;
  draft.metrics = null;
  draft.error = null;
  draft.runId = str(event, "run_id") ?? draft.runId;
  draft.sessionId = str(event, "session_id") ?? draft.sessionId;
  draft.agentId = str(event, "agent_id") ?? draft.agentId;
  draft.header = {
    entityId: str(event, "agent_id") ?? null,
    entityName: str(event, "agent_name") ?? str(event, "agent_id") ?? null,
    model: str(event, "model") ?? null,
    modelProvider: str(event, "model_provider") ?? null,
  };
  return draft;
}

function onRunContent(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const text = typeof event.content === "string" ? event.content : "";
  const reasoning =
    typeof event.reasoning_content === "string" ? event.reasoning_content : "";
  if (text === "" && reasoning === "") return state; // non-string content: ignore during stream

  const container = resolveContainer(state, event);
  const draft = begin(state);
  const parent = containerId(container);
  if (reasoning !== "") {
    appendReasoning(draft, parent, reasoningKey(draft, event), reasoning, tsMs(event));
  }
  if (text !== "") {
    appendTextDelta(draft, parent, text, tsMs(event));
  }
  return draft;
}

function onRunContentCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  void event;
  if (!state.openTextBlockId) return state;
  const draft = begin(state);
  closeTextBlock(draft);
  return draft;
}

function onToolCallStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const tool = getTool(event);
  if (!tool) return state;
  const container = resolveContainer(state, event);
  const draft = begin(state);
  startToolRow(draft, containerId(container), tool, tsMs(event));
  return draft;
}

function onToolCallCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const tool = getTool(event);
  if (!tool) return state;
  const draft = begin(state);
  completeToolRow(draft, tool, tsMs(event));
  return draft;
}

function onRunCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  if (event.event === "RunCompleted") {
    const container = resolveContainer(state, event);
    // Member RunCompleted is a NO-OP (delegation closes on
    // TeamToolCallCompleted); nested workflow-executor RunCompleted likewise
    // (the step closes on StepCompleted).
    if (container.type !== "top") return state;
  }

  const draft = begin(state);
  closeTextBlock(draft);
  draft.status = "completed";
  draft.runCompleted = true;
  draft.paused = null;
  const metrics = event.metrics;
  if (metrics && typeof metrics === "object") {
    draft.metrics = metrics as Metrics;
  }
  if (event.event === "TeamRunCompleted") {
    const responses = event.member_responses;
    if (Array.isArray(responses)) draft.memberResponses = responses;
    // Leader resume rules also apply: nothing may stay open.
    for (const member of openMemberBlocks(draft)) {
      closeMemberBlock(draft, member.id);
    }
  }
  // If nothing streamed, render the final content as a closed text block.
  const streamed = draft.blocks.some(
    (b) => b.kind === "text" && b.parentId === null && b.text.length > 0,
  );
  const content = typeof event.content === "string" ? event.content : "";
  if (!streamed && content !== "") {
    draft.blocks.push({
      id: newId(draft),
      kind: "text",
      parentId: null,
      open: false,
      createdAtMs: tsMs(event),
      text: content,
    });
  }
  return draft;
}

function onRunError(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const message =
    typeof event.content === "string" && event.content !== ""
      ? event.content
      : "Unknown error";

  if (event.event === "RunError") {
    const container = resolveContainer(state, event);
    if (container.type === "member") {
      // Error inside the member block; the delegation still waits for
      // TeamToolCallCompleted to close.
      const draft = begin(state);
      closeTextBlock(draft);
      patchBlock(draft, container.blockId, { status: "error" });
      draft.blocks.push({
        id: newId(draft),
        kind: "error",
        parentId: container.blockId,
        open: false,
        createdAtMs: tsMs(event),
        message,
      });
      return draft;
    }
    if (container.type === "step") {
      const draft = begin(state);
      closeTextBlock(draft);
      draft.blocks.push({
        id: newId(draft),
        kind: "error",
        parentId: container.blockId,
        open: false,
        createdAtMs: tsMs(event),
        message,
      });
      return draft;
    }
  }

  const draft = begin(state);
  closeTextBlock(draft);
  draft.status = "error";
  draft.runCompleted = true;
  draft.error = message;
  draft.blocks.push({
    id: newId(draft),
    kind: "error",
    parentId: null,
    open: false,
    createdAtMs: tsMs(event),
    message,
  });
  return draft;
}

function onRunPaused(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const draft = begin(state);
  closeTextBlock(draft);
  // RunPaused is stream-terminal: setting runCompleted suppresses the
  // Esc/abort handler's server-side cancel for this (ended) stream.
  draft.runCompleted = true;
  draft.status = "paused";
  // requirements (index-signature wire field) is authoritative; tools is the
  // fallback shape only.
  const requirements = arr<AgentOSRequirement>(event.requirements);
  const tools = arr<AgentOSToolExecution>(event.tools);
  const fromRequirements = requirements.length > 0;
  draft.paused = {
    runId: str(event, "run_id") ?? draft.runId,
    sessionId: str(event, "session_id") ?? draft.sessionId,
    agentId:
      str(event, "agent_id") ??
      str(event, "team_id") ??
      draft.agentId ??
      draft.teamId,
    requirements,
    tools,
    toolExecutions: fromRequirements
      ? requirements.map((r) => r.tool_execution)
      : tools,
    source: fromRequirements ? "requirements" : "tools",
  };
  return draft;
}

function onRunContinued(state: TranscriptState): TranscriptState {
  const draft = begin(state);
  // The continue stream is live: the run may be cancelled again.
  draft.status = "running";
  draft.runCompleted = false;
  draft.paused = null;
  draft.statusLine = "continuing...";
  return draft;
}

function onCancelled(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const draft = begin(state);
  closeTextBlock(draft);
  draft.status = "cancelled";
  draft.runCompleted = true;
  draft.blocks.push({
    id: newId(draft),
    kind: "cancelled",
    parentId: null,
    open: false,
    createdAtMs: tsMs(event),
    reason: str(event, "reason") ?? null,
  });
  return draft;
}

// ---------------------------------------------------------------------------
// Reasoning handlers
// ---------------------------------------------------------------------------

function onReasoningStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const draft = begin(state);
  const key = reasoningKey(draft, event);
  const existing = draft.blocks.find(
    (b) => b.kind === "reasoning" && b.key === key,
  );
  if (existing) {
    if (!existing.open) patchBlock(draft, existing.id, { open: true });
    return draft;
  }
  appendReasoning(
    draft,
    containerId(resolveContainer(state, event)),
    key,
    "",
    tsMs(event),
  );
  return draft;
}

interface ReasoningStepDetail {
  title?: string;
  reasoning?: string;
  result?: string;
}

function onReasoningStep(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  let delta =
    typeof event.reasoning_content === "string" ? event.reasoning_content : "";
  if (delta === "") {
    const extra = event.extra_data;
    const steps =
      extra && typeof extra === "object"
        ? arr<ReasoningStepDetail>((extra as Record<string, unknown>).reasoning_steps)
        : [];
    if (steps.length > 0) {
      delta = steps
        .map((s) =>
          [s.title, s.reasoning, s.result].filter(Boolean).join(" — "),
        )
        .join("\n");
    } else if (typeof event.content === "string") {
      delta = event.content;
    }
  }
  if (delta === "") return state;
  const draft = begin(state);
  appendReasoning(
    draft,
    containerId(resolveContainer(state, event)),
    reasoningKey(draft, event),
    delta,
    tsMs(event),
  );
  return draft;
}

function onReasoningCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const key = `${str(event, "run_id") ?? state.runId ?? "run"}:reasoning`;
  const existing = state.blocks.find(
    (b) => b.kind === "reasoning" && b.key === key && b.open,
  );
  if (!existing) return state;
  const draft = begin(state);
  patchBlock(draft, existing.id, { open: false });
  return draft;
}

// ---------------------------------------------------------------------------
// Team event handlers
// ---------------------------------------------------------------------------

function onTeamRunStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const draft = begin(state);
  draft.status = "running";
  draft.runCompleted = false;
  draft.paused = null;
  draft.metrics = null;
  draft.error = null;
  draft.runId = str(event, "run_id") ?? draft.runId;
  draft.sessionId = str(event, "session_id") ?? draft.sessionId;
  draft.teamId = str(event, "team_id") ?? draft.teamId;
  draft.header = {
    entityId: str(event, "team_id") ?? null,
    entityName: str(event, "team_name") ?? str(event, "team_id") ?? null,
    model: str(event, "model") ?? null,
    modelProvider: str(event, "model_provider") ?? null,
  };
  return draft;
}

function onTeamRunContent(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const text = typeof event.content === "string" ? event.content : "";
  const reasoning =
    typeof event.reasoning_content === "string" ? event.reasoning_content : "";
  const members = state.blocks.some((b) => b.kind === "member" && b.open);
  if (text === "" && reasoning === "" && !members) return state;

  const draft = begin(state);
  // Leader resumed speaking: any open member block closes first.
  for (const member of openMemberBlocks(draft)) {
    closeMemberBlock(draft, member.id);
  }
  if (reasoning !== "") {
    appendReasoning(draft, null, reasoningKey(draft, event), reasoning, tsMs(event));
  }
  if (text !== "") {
    appendTextDelta(draft, null, text, tsMs(event));
  }
  return draft;
}

const DELEGATE_TOOL = "delegate_task_to_member";

function onTeamToolCallStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const tool = getTool(event);
  if (!tool) return state;

  if (tool.tool_name !== DELEGATE_TOOL) {
    const draft = begin(state);
    startToolRow(draft, null, tool, tsMs(event));
    return draft;
  }

  // Open a member block: provisional title = member_id (upgraded on the
  // member's RunStarted), subtitle = task.
  const args = tool.tool_args ?? {};
  const memberId =
    typeof args.member_id === "string" && args.member_id !== ""
      ? args.member_id
      : "member";
  const task = typeof args.task === "string" ? args.task : null;
  const draft = begin(state);
  closeTextBlock(draft); // leader text closes before the member block opens
  const block: MemberBlock = {
    id: newId(draft),
    kind: "member",
    parentId: null,
    open: true,
    createdAtMs: tsMs(event),
    memberId,
    name: memberId,
    task,
    status: "running",
    delegationToolCallId: tool.tool_call_id,
  };
  draft.blocks.push(block);
  draft.currentMemberBlockId = block.id;
  return draft;
}

function onTeamToolCallCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const tool = getTool(event);
  if (!tool) return state;

  if (tool.tool_name !== DELEGATE_TOOL) {
    const draft = begin(state);
    completeToolRow(draft, tool, tsMs(event));
    return draft;
  }

  // Delegation boundary: this — and only this — closes the member block.
  const open = openMemberBlocks(state);
  const target =
    open.find((b) => b.delegationToolCallId === tool.tool_call_id) ??
    open.find((b) => b.id === state.currentMemberBlockId) ??
    open[open.length - 1];
  if (!target) return state;
  const draft = begin(state);
  closeMemberBlock(draft, target.id);
  return draft;
}

// ---------------------------------------------------------------------------
// Workflow event handlers
// ---------------------------------------------------------------------------

function onWorkflowStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const draft = begin(state);
  draft.status = "running";
  draft.runCompleted = false;
  draft.paused = null;
  draft.metrics = null;
  draft.error = null;
  draft.runId = str(event, "run_id") ?? draft.runId;
  draft.sessionId = str(event, "session_id") ?? draft.sessionId;
  draft.workflowId = str(event, "workflow_id") ?? draft.workflowId;
  draft.header = {
    entityId: str(event, "workflow_id") ?? null,
    entityName:
      str(event, "workflow_name") ?? str(event, "workflow_id") ?? null,
    model: null,
    modelProvider: null,
  };
  return draft;
}

function onWorkflowCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  void event;
  const draft = begin(state);
  closeTextBlock(draft);
  for (const id of draft.workflowStack) {
    const block = getBlock(draft, id);
    if (block?.open) patchBlock(draft, id, { open: false });
  }
  draft.workflowStack = [];
  draft.status = "completed";
  draft.runCompleted = true;
  return draft;
}

function onStepStarted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const draft = begin(state);
  closeTextBlock(draft);
  const stepIndex = (event.step_index ?? null) as
    | number
    | [number, number]
    | null;
  const block: StepBlock = {
    id: newId(draft),
    kind: "step",
    parentId: innermostContainer(draft),
    open: true,
    createdAtMs: tsMs(event),
    stepId: str(event, "step_id") ?? null,
    stepName: str(event, "step_name") ?? null,
    stepIndex,
    stepIndexLabel: formatStepIndex(stepIndex),
    executorName: null,
    output: null,
    durationSeconds: null,
    metrics: null,
  };
  draft.blocks.push(block);
  draft.workflowStack.push(block.id);
  return draft;
}

function findStepTarget(
  state: TranscriptState,
  event: StreamEvent,
): StepBlock | undefined {
  const steps = openStepBlocks(state);
  if (steps.length === 0) return undefined;
  const stepId = str(event, "step_id");
  if (stepId) {
    const m = steps.find((b) => b.stepId === stepId);
    if (m) return m;
  }
  const stepName = str(event, "step_name");
  if (stepName) {
    const m = steps.find((b) => b.stepName === stepName);
    if (m) return m;
  }
  if (event.step_index !== undefined) {
    const m = steps.find((b) => sameStepIndex(b.stepIndex, event.step_index));
    if (m) return m;
  }
  return steps[steps.length - 1];
}

function onStepOutput(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const target = findStepTarget(state, event);
  if (!target) return state;
  const so = (
    event.step_output && typeof event.step_output === "object"
      ? event.step_output
      : {}
  ) as Record<string, unknown>;
  const output: StepOutputSummary = {
    content:
      typeof so.content === "string"
        ? so.content
        : typeof event.content === "string"
          ? event.content
          : undefined,
    success:
      typeof so.success === "boolean"
        ? so.success
        : typeof event.success === "boolean"
          ? event.success
          : undefined,
    error:
      typeof so.error === "string"
        ? so.error
        : typeof event.error === "string"
          ? event.error
          : undefined,
    stop:
      typeof so.stop === "boolean"
        ? so.stop
        : typeof event.stop === "boolean"
          ? event.stop
          : undefined,
  };
  const draft = begin(state);
  patchBlock(draft, target.id, { output });
  return draft;
}

function onStepCompleted(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const target = findStepTarget(state, event);
  if (!target) return state;
  const draft = begin(state);
  closeTextBlock(draft);
  const sr = (
    event.step_response && typeof event.step_response === "object"
      ? event.step_response
      : {}
  ) as Record<string, unknown>;
  const patch: Partial<StepBlock> = { open: false };
  if (typeof sr.duration === "number") patch.durationSeconds = sr.duration;
  if (sr.metrics && typeof sr.metrics === "object") {
    patch.metrics = sr.metrics as Metrics;
  }
  const success = typeof sr.success === "boolean" ? sr.success : undefined;
  // Content fallback: if the step streamed nothing and captured no output,
  // surface the completion content.
  const streamed = draft.blocks.some(
    (b) => b.kind === "text" && b.parentId === target.id && b.text.length > 0,
  );
  if (target.output === null && !streamed) {
    const content = typeof event.content === "string" ? event.content : "";
    if (content !== "" || success !== undefined) {
      patch.output = { content: content || undefined, success };
    }
  } else if (target.output !== null && success !== undefined && target.output.success === undefined) {
    patch.output = { ...target.output, success };
  }
  patchBlock(draft, target.id, patch);
  draft.workflowStack = draft.workflowStack.filter((id) => id !== target.id);
  return draft;
}

const GROUP_META_KEYS = [
  "parallel_step_count",
  "condition_result",
  "max_iterations",
  "iteration",
  "total_iterations",
  "should_continue",
  "selected_steps",
  "executed_steps",
  "steps_count",
  "step_results",
] as const;

function groupMeta(event: StreamEvent): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of GROUP_META_KEYS) {
    if (event[key] !== undefined) meta[key] = event[key];
  }
  return meta;
}

function onGroupStarted(
  state: TranscriptState,
  event: StreamEvent,
  groupType: GroupType,
): TranscriptState {
  const draft = begin(state);
  closeTextBlock(draft);
  const id = newId(draft);
  draft.blocks.push({
    id,
    kind: "group",
    parentId: innermostContainer(draft),
    open: true,
    createdAtMs: tsMs(event),
    groupType,
    stepId: str(event, "step_id") ?? null,
    stepName: str(event, "step_name") ?? null,
    meta: groupMeta(event),
  });
  draft.workflowStack.push(id);
  return draft;
}

function onGroupCompleted(
  state: TranscriptState,
  event: StreamEvent,
  groupType: GroupType,
): TranscriptState {
  const groups = state.blocks.filter(
    (b) => b.kind === "group" && b.open && b.groupType === groupType,
  );
  if (groups.length === 0) return state;
  const stepId = str(event, "step_id");
  const target =
    (stepId && groups.find((b) => b.kind === "group" && b.stepId === stepId)) ||
    groups[groups.length - 1];
  const draft = begin(state);
  const existing = getBlock(draft, target.id);
  patchBlock(draft, target.id, {
    open: false,
    meta: {
      ...(existing && existing.kind === "group" ? existing.meta : {}),
      ...groupMeta(event),
    },
  });
  draft.workflowStack = draft.workflowStack.filter((id) => id !== target.id);
  return draft;
}

function onLoopIteration(
  state: TranscriptState,
  event: StreamEvent,
): TranscriptState {
  const target = state.blocks.find(
    (b) => b.kind === "group" && b.open && b.groupType === "loop",
  );
  if (!target || target.kind !== "group") return state;
  const draft = begin(state);
  patchBlock(draft, target.id, {
    meta: { ...target.meta, ...groupMeta(event) },
  });
  return draft;
}
