import type { AgentStream, StreamEvent } from "@worksofadam/agentos-sdk";
import chalk from "chalk";
import type { Command } from "commander";
import { getOutputFormat, writeError, writeWarning } from "./agentos-output.js";
import type { PausedRunState } from "./agentos-paused-runs.js";
import { mergePausedRun } from "./agentos-paused-runs.js";

// Ported from agno-cli/src/lib/stream.ts. Hint messages updated to point at
// the ixora `agents continue` surface.

export type ResourceType = "agent" | "team" | "workflow";

export interface StreamRunOptions {
  resourceId: string;
  /** Original message that started this run — persisted in the paused-state
   *  cache so `agents pending` can suggest a re-run command if the cache
   *  outlived the user's shell history. */
  prompt?: string;
}

const CONTENT_EVENTS: Record<ResourceType, string> = {
  agent: "RunContent",
  team: "TeamRunContent",
  workflow: "StepOutput",
} as const;

const COMPLETED_EVENTS: Record<ResourceType, string> = {
  agent: "RunCompleted",
  team: "TeamRunCompleted",
  workflow: "WorkflowCompleted",
} as const;

const ERROR_EVENTS: Record<ResourceType, string> = {
  agent: "RunError",
  team: "TeamRunError",
  workflow: "WorkflowCancelled",
} as const;

const PAUSED_EVENTS: Partial<Record<ResourceType, string>> = {
  agent: "RunPaused",
} as const;

const STARTED_EVENTS: Record<ResourceType, string> = {
  agent: "RunStarted",
  team: "TeamRunStarted",
  workflow: "WorkflowStarted",
} as const;

function formatContent(content: unknown): string {
  if (content == null) return "";
  return typeof content === "string"
    ? content
    : JSON.stringify(content, null, 2);
}

/** Shape of a single pending tool stored in the paused-state cache. */
type PendingTool = PausedRunState["tools"][number];

/** Shape returned by `projectCompact` — the agent-friendly run summary. */
export interface CompactRunResult {
  status: string | null;
  run_id: string | null;
  session_id: string | null;
  agent_id: string | null;
  content: string | null;
  /** null when no pending tools, single object when one, array when >1. */
  pending_tool: PendingTool | PendingTool[] | null;
  metrics: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    duration?: number;
  };
}

/**
 * Extract pending tool calls from a paused non-stream response.
 *
 * Prefers `requirements[].tool_execution` (the SDK's authoritative list of
 * pending tool executions) over the top-level `tools[]` array, which contains
 * all tool calls in the run (completed + pending). Falls back to filtering
 * `tools[]` for entries where `requires_confirmation === true` and
 * `confirmed` is null/undefined.
 *
 * Returns an empty array when neither source yields anything.
 */
export function extractPendingTools(
  resultObj: Record<string, unknown> | null | undefined,
): PendingTool[] {
  if (!resultObj) return [];

  const requirements = resultObj.requirements as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(requirements) && requirements.length > 0) {
    const fromReqs: PendingTool[] = [];
    for (const req of requirements) {
      const tx = req.tool_execution as Record<string, unknown> | undefined;
      if (!tx || typeof tx !== "object") continue;
      // Only emit pending (unconfirmed) requirements. The SDK keeps already-confirmed
      // tool_executions in requirements[] across continues, so a naive map would
      // cache and re-confirm a tool that already ran.
      if (tx.confirmed !== null && tx.confirmed !== undefined) continue;
      if (tx.requires_confirmation !== true) continue;
      const toolCallId = tx.tool_call_id as string | undefined;
      const toolName = tx.tool_name as string | undefined;
      if (!toolCallId || !toolName) continue;
      fromReqs.push({
        tool_call_id: toolCallId,
        tool_name: toolName,
        tool_args: (tx.tool_args as Record<string, unknown>) ?? {},
        requires_confirmation: true,
        confirmed: tx.confirmed as boolean | null | undefined,
        created_at: tx.created_at as number | undefined,
      });
    }
    if (fromReqs.length > 0) return fromReqs;
  }

  const tools = resultObj.tools as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tools)) return [];
  return tools
    .filter(
      (t) =>
        t.requires_confirmation === true &&
        (t.confirmed === null || t.confirmed === undefined),
    )
    .map((t) => ({
      tool_call_id: String(t.tool_call_id ?? ""),
      tool_name: String(t.tool_name ?? ""),
      tool_args: (t.tool_args as Record<string, unknown>) ?? {},
      requires_confirmation: true,
      confirmed: t.confirmed as boolean | null | undefined,
      created_at: t.created_at as number | undefined,
    }))
    .filter((t) => t.tool_call_id && t.tool_name);
}

/**
 * Filter the raw `tools[]` list from a RunPaused stream event down to the
 * subset that actually needs confirmation. The event includes every tool
 * call from the run — completed ones come through with `confirmed: true`
 * (or no requires_confirmation flag) and were already executed server-side;
 * showing them in the pause prompt or sending them back via --confirm is
 * misleading at best, double-execution at worst.
 */
function filterPendingEventTools(
  tools: Array<Record<string, unknown>>,
): PendingTool[] {
  return tools
    .filter(
      (t) =>
        t.requires_confirmation === true &&
        (t.confirmed === null || t.confirmed === undefined),
    )
    .map((t) => ({
      tool_call_id: String(t.tool_call_id ?? ""),
      tool_name: String(t.tool_name ?? ""),
      tool_args: (t.tool_args as Record<string, unknown>) ?? {},
      requires_confirmation: true,
      confirmed: t.confirmed as boolean | null | undefined,
      created_at: t.created_at as number | undefined,
    }))
    .filter((t) => t.tool_call_id && t.tool_name);
}

/**
 * Project a raw SDK run response down to the compact agent-friendly shape.
 *
 * Pure projection: no IO. Missing fields become `null`/`{}` rather than
 * being omitted, so consumers see a stable schema.
 */
export function projectCompact(
  resultObj: Record<string, unknown> | null | undefined,
  pendingTools: PendingTool[],
): CompactRunResult {
  const obj = resultObj ?? {};
  const rawContent = obj.content;
  const content =
    rawContent == null
      ? null
      : typeof rawContent === "string"
        ? rawContent
        : JSON.stringify(rawContent);
  const metrics = (obj.metrics as Record<string, unknown> | undefined) ?? {};

  let pending_tool: CompactRunResult["pending_tool"];
  if (pendingTools.length === 0) pending_tool = null;
  else if (pendingTools.length === 1) pending_tool = pendingTools[0] ?? null;
  else pending_tool = pendingTools;

  return {
    status: (obj.status as string | undefined) ?? null,
    run_id: (obj.run_id as string | undefined) ?? null,
    session_id: (obj.session_id as string | undefined) ?? null,
    agent_id: (obj.agent_id as string | undefined) ?? null,
    content,
    pending_tool,
    metrics: {
      input_tokens: metrics.input_tokens as number | undefined,
      output_tokens: metrics.output_tokens as number | undefined,
      total_tokens: metrics.total_tokens as number | undefined,
      duration: metrics.duration as number | undefined,
    },
  };
}

/**
 * Pretty-print the pending tool calls and the next-step commands. Always
 * writes to stderr so it composes with `-o json` / `-o compact` output on
 * stdout without corrupting it.
 */
export function displayPausedToolInfo(
  tools: Array<Record<string, unknown>>,
  resourceId: string,
  runId: string,
): void {
  process.stderr.write(
    `\n${chalk.yellow.bold("[Run Paused -- Tool requires confirmation]")}\n\n`,
  );
  for (const tool of tools) {
    process.stderr.write(
      `  Tool:  ${chalk.cyan(String(tool.tool_name ?? "unknown"))}\n`,
    );
    process.stderr.write(
      `  Args:  ${JSON.stringify(tool.tool_args ?? {})}\n`,
    );
    process.stderr.write(
      `  ID:    ${String(tool.tool_call_id ?? "unknown")}\n\n`,
    );
  }
  process.stderr.write(
    `To confirm: ${chalk.green(`ixora agents continue ${runId} --confirm --stream`)}\n`,
  );
  process.stderr.write(
    `To reject:  ${chalk.red(`ixora agents continue ${runId} --reject --stream`)}\n`,
  );
  process.stderr.write(
    `${chalk.dim(`(agent_id ${resourceId} will be looked up from the cache)`)}\n`,
  );
}

/**
 * Result of a streamed run. `paused` is true if a RunPaused event fired.
 * When paused, the run/session IDs and pending tool list are surfaced so
 * the caller can drive an interactive resume loop without re-parsing the
 * stream.
 */
export interface StreamRunResult {
  paused: boolean;
  runId?: string | null;
  sessionId?: string | null;
  pendingTools?: PendingTool[];
}

/** Exit code emitted when a run paused awaiting tool confirmation. Scripts
 *  can branch on this without parsing JSON output. */
export const EXIT_CODE_PAUSED = 4;

export async function handleStreamRun(
  cmd: Command,
  stream: AgentStream,
  resourceType: ResourceType,
  options?: StreamRunOptions,
): Promise<StreamRunResult> {
  let observedPause = false;
  // Hoisted so both the json/compact and table branches can publish pause
  // details out to the function's return value without restructuring.
  let pauseRunId: string | null = null;
  let pauseSessionId: string | null = null;
  let pausePendingTools: PendingTool[] = [];
  const format = getOutputFormat(cmd);
  const contentEvent = CONTENT_EVENTS[resourceType];
  const completedEvent = COMPLETED_EVENTS[resourceType];
  const errorEvent = ERROR_EVENTS[resourceType];
  const pausedEvent = PAUSED_EVENTS[resourceType];
  const startedEvent = STARTED_EVENTS[resourceType];

  const onSigint = () => {
    stream.abort();
  };
  process.on("SIGINT", onSigint);

  try {
    if (format === "json" || format === "compact") {
      const events: StreamEvent[] = [];
      let accSessionId: string | null = null;
      let accRunId: string | null = null;
      let accAgentId: string | null = options?.resourceId ?? null;
      let accStatus: string | null = null;
      let accContent = "";
      let accMetrics: Record<string, unknown> | undefined;
      let accPendingTools: PendingTool[] = [];
      for await (const event of stream) {
        if (format === "json") events.push(event);
        const ev = event as Record<string, unknown>;
        if (startedEvent && event.event === startedEvent) {
          accSessionId = (ev.session_id as string) ?? accSessionId;
          accRunId = (ev.run_id as string) ?? accRunId;
          accAgentId = (ev.agent_id as string) ?? accAgentId;
          accStatus = accStatus ?? "RUNNING";
        } else if (event.event === contentEvent) {
          const c = ev.content;
          if (typeof c === "string") accContent += c;
          else if (c != null) accContent += JSON.stringify(c);
        } else if (event.event === completedEvent) {
          accMetrics = ev.metrics as Record<string, unknown> | undefined;
          accStatus = (ev.status as string) ?? "COMPLETED";
          const finalContent = ev.content;
          if (typeof finalContent === "string" && finalContent.length > 0) {
            accContent = finalContent;
          } else if (finalContent != null && accContent === "") {
            accContent = JSON.stringify(finalContent);
          }
        } else if (event.event === errorEvent) {
          accStatus = "ERROR";
        } else if (pausedEvent && event.event === pausedEvent) {
          accStatus = "PAUSED";
          observedPause = true;
          const tools = ev.tools as Array<Record<string, unknown>> | undefined;
          const eventRunId: string | null =
            (ev.run_id as string | undefined) ?? accRunId;
          accRunId = eventRunId;
          if (tools && tools.length > 0) {
            // Filter out already-completed tool calls from the event payload —
            // RunPaused includes the full run history, but only unconfirmed
            // tools actually need user input.
            accPendingTools = filterPendingEventTools(tools);
            if (
              accPendingTools.length > 0 &&
              options?.resourceId &&
              resourceType === "agent"
            ) {
              mergePausedRun({
                agent_id: options.resourceId,
                run_id: eventRunId ?? "unknown",
                session_id: accSessionId,
                resource_type: resourceType,
                paused_at: new Date().toISOString(),
                prompt: options.prompt,
                tools: accPendingTools,
              });
              displayPausedToolInfo(
                accPendingTools as unknown as Array<Record<string, unknown>>,
                options.resourceId,
                eventRunId ?? "unknown",
              );
              pauseRunId = eventRunId;
              pauseSessionId = accSessionId;
              pausePendingTools = accPendingTools;
            }
          }
        }
      }
      if (format === "json") {
        process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
      } else {
        const compact = projectCompact(
          {
            status: accStatus,
            run_id: accRunId,
            session_id: accSessionId,
            agent_id: accAgentId,
            content: accContent,
            metrics: accMetrics,
          },
          accPendingTools,
        );
        process.stdout.write(`${JSON.stringify(compact, null, 2)}\n`);
      }
    } else {
      let metrics: Record<string, unknown> | undefined;
      let sessionId: string | null = null;
      let runId: string | null = null;

      for await (const event of stream) {
        if (event.event === errorEvent) {
          const errorMsg =
            (event as Record<string, unknown>).error ??
            (event as Record<string, unknown>).content ??
            "Unknown stream error";
          writeError(String(errorMsg));
          process.exitCode = 2;
        } else if (event.event === contentEvent) {
          const content = (event as Record<string, unknown>).content;
          if (content != null) {
            process.stdout.write(formatContent(content));
          }
        } else if (event.event === completedEvent) {
          metrics = (event as Record<string, unknown>).metrics as
            | Record<string, unknown>
            | undefined;
        } else if (event.event === startedEvent) {
          sessionId =
            ((event as Record<string, unknown>).session_id as string) ?? null;
          runId =
            ((event as Record<string, unknown>).run_id as string) ?? null;
        } else if (pausedEvent && event.event === pausedEvent) {
          observedPause = true;
          const tools = (event as Record<string, unknown>).tools as
            | Array<Record<string, unknown>>
            | undefined;
          const eventRunId =
            ((event as Record<string, unknown>).run_id as string) ?? runId;
          if (tools && tools.length > 0 && options?.resourceId) {
            // Filter out already-completed tool calls — see
            // filterPendingEventTools for the rationale.
            const pending = filterPendingEventTools(tools);
            if (pending.length > 0) {
              mergePausedRun({
                agent_id: options.resourceId,
                run_id: eventRunId ?? "unknown",
                session_id: sessionId,
                resource_type: resourceType,
                paused_at: new Date().toISOString(),
                prompt: options.prompt,
                tools: pending,
              });
              displayPausedToolInfo(
                pending as unknown as Array<Record<string, unknown>>,
                options.resourceId,
                eventRunId ?? "unknown",
              );
              // Capture for return so callers can drive an interactive resume
              // without re-parsing the stream.
              pauseRunId = eventRunId ?? null;
              pauseSessionId = sessionId;
              pausePendingTools = pending;
            }
          }
        }
      }
      process.stdout.write("\n");
      if (metrics) {
        printMetrics(metrics);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
  if (observedPause) {
    process.exitCode = EXIT_CODE_PAUSED;
    return {
      paused: true,
      runId: pauseRunId,
      sessionId: pauseSessionId,
      pendingTools: pausePendingTools,
    };
  }
  return { paused: false };
}

/**
 * Run or process a non-streaming agent/team/workflow response.
 *
 * Accepts either a `runFn` (the common case: do the SDK call here, show a
 * spinner) or a pre-fetched `{ result }` (used by `*-continue` handlers
 * that already have the response and just want shared output + cache
 * handling). The result branch skips the spinner — it would spin for
 * effectively 0ms and lie about a pending network call.
 *
 * Side effects beyond writing output:
 *   - When the run paused and `resourceType === "agent"`, write the pending
 *     tool calls to `~/.ixora/agentos-paused-runs/<run_id>.json` so a later
 *     `agents continue --confirm` can reconstruct the payload without
 *     re-running the agent.
 */
export async function handleNonStreamRun(
  cmd: Command,
  input: (() => Promise<unknown>) | { result: unknown },
  options?: {
    resourceType?: ResourceType;
    resourceId?: string;
    /** Original message that started this run; persisted for `agents pending`. */
    prompt?: string;
  },
): Promise<void> {
  const format = getOutputFormat(cmd);

  let result: unknown;
  if (typeof input === "function") {
    const ora = (await import("ora")).default;
    const spinner = ora({ text: "Running...", stream: process.stderr }).start();
    try {
      result = await input();
    } finally {
      spinner.stop();
    }
  } else {
    result = input.result;
  }

  const resultObj = result as Record<string, unknown>;
  const statusStr =
    typeof resultObj?.status === "string" ? resultObj.status.toLowerCase() : "";
  const isPaused = resultObj?.is_paused === true || statusStr === "paused";
  const pendingTools = isPaused ? extractPendingTools(resultObj) : [];

  if (
    isPaused &&
    pendingTools.length > 0 &&
    options?.resourceId &&
    options?.resourceType === "agent"
  ) {
    const pausedRunId = (resultObj?.run_id as string) ?? "unknown";
    const pausedSessionId = (resultObj?.session_id as string) ?? null;
    mergePausedRun({
      agent_id: options.resourceId,
      run_id: pausedRunId,
      session_id: pausedSessionId,
      resource_type: options.resourceType,
      paused_at: new Date().toISOString(),
      prompt: options.prompt,
      tools: pendingTools,
    });
    // Always show the pause hint on stderr — used to be table-only, but
    // -o json/-o compact users were left without a next-step command.
    displayPausedToolInfo(
      pendingTools as unknown as Array<Record<string, unknown>>,
      options.resourceId,
      pausedRunId,
    );
  } else if (
    isPaused &&
    pendingTools.length === 0 &&
    options?.resourceType === "agent"
  ) {
    writeWarning(
      "Run paused but no pending tool calls could be extracted from the response. --confirm will not work for this run.",
    );
  }
  if (isPaused) process.exitCode = EXIT_CODE_PAUSED;

  if (format === "compact") {
    process.stdout.write(
      `${JSON.stringify(projectCompact(resultObj, pendingTools), null, 2)}\n`,
    );
    return;
  }

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const content = (result as Record<string, unknown>)?.content;
  if (content != null) {
    process.stdout.write(`${formatContent(content)}\n`);
  }
  const metrics = (result as Record<string, unknown>)?.metrics as
    | Record<string, unknown>
    | undefined;
  if (metrics) {
    printMetrics(metrics);
  }
}

export function printMetrics(
  metrics: Record<string, unknown> | undefined | null,
): void {
  if (!metrics) return;

  const parts: string[] = [];
  const inputTokens = metrics.input_tokens as number | undefined;
  const outputTokens = metrics.output_tokens as number | undefined;
  const totalTokens = metrics.total_tokens as number | undefined;
  const duration = metrics.duration as number | undefined;

  if (inputTokens && outputTokens) {
    parts.push(`tokens: ${inputTokens}/${outputTokens}`);
  } else if (totalTokens) {
    parts.push(`tokens: ${totalTokens}`);
  }

  if (duration) {
    parts.push(`time: ${duration.toFixed(2)}s`);
  }

  if (parts.length > 0) {
    process.stderr.write(`${chalk.dim(`[${parts.join(", ")}]`)}\n`);
  }
}
