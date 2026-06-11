// Transcript block model + state for `ixora chat`.
//
// Pure data: no TUI, no network. The reducer (reducer.ts) folds SDK
// StreamEvents into a TranscriptState; the TUI projects `blocks` directly —
// the list is append/patch ordered, every block has a stable id, an `open`
// flag, and an optional `parentId` for nesting (member blocks, workflow
// steps/groups). All timestamps are unix MILLISECONDS (wire `created_at` is
// unix seconds; the reducer multiplies by 1000).

import type { Metrics, ToolCallData } from "@worksofadam/agentos-sdk";

// ---------------------------------------------------------------------------
// HITL wire shapes (RunPaused). The SDK types RunPaused.tools as
// ToolCallData[], but the wire entries carry these extra confirmation fields;
// `requirements` is a top-level wire field read via the StreamEvent index
// signature (not in the SDK interface at all).
// ---------------------------------------------------------------------------

export interface AgentOSToolExecution {
  tool_call_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  requires_confirmation: boolean;
  confirmed: boolean | null;
  confirmation_note: string | null;
}

export interface AgentOSRequirement {
  id: string;
  created_at: string; // ISO string on the wire (unlike event created_at)
  tool_execution: AgentOSToolExecution;
}

/** Captured on RunPaused; consumed by the HITL controller. */
export interface PausedState {
  runId: string | null;
  sessionId: string | null;
  /** agent_id or team_id of the paused run. */
  agentId: string | null;
  /** Raw wire shapes, both kept for fidelity. */
  requirements: AgentOSRequirement[];
  tools: AgentOSToolExecution[];
  /** Normalized: requirements[].tool_execution preferred, tools[] fallback. */
  toolExecutions: AgentOSToolExecution[];
  source: "requirements" | "tools";
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type BlockKind =
  | "text"
  | "reasoning"
  | "tool"
  | "member"
  | "step"
  | "group"
  | "error"
  | "cancelled";

interface BaseBlock {
  /** Stable unique id ("b1", "b2", ...) — safe to key TUI components on. */
  id: string;
  kind: BlockKind;
  /** Containing member/step/group block id, or null for top level. */
  parentId: string | null;
  open: boolean;
  createdAtMs: number;
}

/** Streaming text; deltas append while open, trimEnd'd on close. */
export interface TextBlock extends BaseBlock {
  kind: "text";
  text: string;
}

/** Reasoning lane, keyed `${runId}:reasoning`; rendered dimmed/collapsible. */
export interface ReasoningBlock extends BaseBlock {
  kind: "reasoning";
  key: string;
  text: string;
}

export type ToolStatus = "running" | "success" | "error";

/** One tool row, keyed by tool_call_id, completed in place. */
export interface ToolBlock extends BaseBlock {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** `k=v` comma-joined, values JSON-stringified and truncated to 50 chars. */
  argsSummary: string;
  status: ToolStatus;
  result: string | null;
  /** From tool.metrics.duration; falls back to event-timestamp delta. */
  durationSeconds: number | null;
  startedAtMs: number;
}

export type MemberStatus = "running" | "completed" | "error";

/**
 * Delegated team-member block. Opens on delegate_task_to_member with the
 * provisional member_id as title; member RunStarted upgrades name/memberId;
 * closes ONLY on the matching TeamToolCallCompleted (or leader resume).
 * Child blocks reference it via parentId.
 */
export interface MemberBlock extends BaseBlock {
  kind: "member";
  /** Canonical id: delegation member_id slug until upgraded to agent_id. */
  memberId: string;
  /** Display title: member_id slug until upgraded to agent_name. */
  name: string;
  task: string | null;
  status: MemberStatus;
  /** tool_call_id of the delegate_task_to_member call that opened this. */
  delegationToolCallId: string;
}

/** Output captured from StepOutput / StepCompleted content fallback. */
export interface StepOutputSummary {
  content?: string;
  success?: boolean;
  error?: string | null;
  stop?: boolean;
}

/** Workflow step block; nested executor events route here via step_id. */
export interface StepBlock extends BaseBlock {
  kind: "step";
  stepId: string | null;
  stepName: string | null;
  stepIndex: number | [number, number] | null;
  /** Tuple rendered as "group.position" (e.g. "1.0"), number as "0". */
  stepIndexLabel: string | null;
  executorName: string | null;
  output: StepOutputSummary | null;
  durationSeconds: number | null;
  metrics: Metrics | null;
}

export type GroupType = "parallel" | "condition" | "loop" | "router" | "steps";

/** Workflow grouping construct (Parallel/Condition/Loop/Router/Steps). */
export interface GroupBlock extends BaseBlock {
  kind: "group";
  groupType: GroupType;
  stepId: string | null;
  stepName: string | null;
  /** Raw detail fields (parallel_step_count, iteration, selected_steps...). */
  meta: Record<string, unknown>;
}

export interface ErrorBlock extends BaseBlock {
  kind: "error";
  message: string;
}

export interface CancelledBlock extends BaseBlock {
  kind: "cancelled";
  reason: string | null;
}

export type Block =
  | TextBlock
  | ReasoningBlock
  | ToolBlock
  | MemberBlock
  | StepBlock
  | GroupBlock
  | ErrorBlock
  | CancelledBlock;

// ---------------------------------------------------------------------------
// Transcript state
// ---------------------------------------------------------------------------

export type TranscriptStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export interface TranscriptHeader {
  entityId: string | null;
  entityName: string | null;
  model: string | null;
  modelProvider: string | null;
}

export interface TranscriptState {
  /** Ordered block list (nested blocks point at containers via parentId). */
  blocks: Block[];
  /** Monotonic id source for blocks. */
  nextBlockSeq: number;
  status: TranscriptStatus;
  /** Transient status-line text (e.g. "continuing..." after RunContinued). */
  statusLine: string | null;
  runId: string | null;
  sessionId: string | null;
  agentId: string | null;
  teamId: string | null;
  workflowId: string | null;
  header: TranscriptHeader | null;
  /**
   * True once the stream reached a terminal event (RunCompleted/RunError/
   * RunCancelled) OR RunPaused (stream-terminal). Guards the Esc handler:
   * never call cancel(id, runId) when true. RunContinued resets it.
   */
  runCompleted: boolean;
  paused: PausedState | null;
  /** Metrics footer from RunCompleted/TeamRunCompleted. */
  metrics: Metrics | null;
  /** TeamRunCompleted.member_responses, for the member summary. */
  memberResponses: unknown[] | null;
  /** Terminal error message (RunError content), for non-zero exits. */
  error: string | null;
  // --- routing pointers (projection-safe, but primarily reducer-internal) ---
  openTextBlockId: string | null;
  /** Positional member-attribution fallback (agent_id match is preferred). */
  currentMemberBlockId: string | null;
  /** Open workflow container block ids, outermost first. */
  workflowStack: string[];
}

/** Re-exported SDK shapes the block model leans on. */
export type { Metrics, ToolCallData };
