import type { AgentStream, StreamEvent } from "@worksofadam/agentos-sdk";
import chalk from "chalk";
import type { Command } from "commander";
import { getOutputFormat, writeError } from "./agentos-output.js";
import type { PausedRunState } from "./agentos-paused-runs.js";
import { writePausedRun } from "./agentos-paused-runs.js";

// Ported from agno-cli/src/lib/stream.ts. Hint messages updated to point at
// the ixora `agents continue` surface.

export type ResourceType = "agent" | "team" | "workflow";

export interface StreamRunOptions {
  resourceId: string;
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

function displayPausedToolInfo(
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
    `To confirm: ${chalk.green(`ixora agents continue ${resourceId} ${runId} --confirm --stream`)}\n`,
  );
  process.stderr.write(
    `To reject:  ${chalk.red(`ixora agents continue ${resourceId} ${runId} --reject --stream`)}\n`,
  );
}

export async function handleStreamRun(
  cmd: Command,
  stream: AgentStream,
  resourceType: ResourceType,
  options?: StreamRunOptions,
): Promise<void> {
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
    if (format === "json") {
      const events: StreamEvent[] = [];
      let jsonSessionId: string | null = null;
      for await (const event of stream) {
        events.push(event);
        if (startedEvent && event.event === startedEvent) {
          jsonSessionId =
            ((event as Record<string, unknown>).session_id as string) ?? null;
        }
        if (
          pausedEvent &&
          event.event === pausedEvent &&
          options?.resourceId
        ) {
          const tools = (event as Record<string, unknown>).tools as
            | Array<Record<string, unknown>>
            | undefined;
          const eventRunId = (event as Record<string, unknown>).run_id as
            | string
            | undefined;
          if (tools && tools.length > 0) {
            writePausedRun({
              agent_id: options.resourceId,
              run_id: eventRunId ?? "unknown",
              session_id: jsonSessionId,
              resource_type: resourceType,
              paused_at: new Date().toISOString(),
              tools: tools as PausedRunState["tools"],
            });
          }
        }
      }
      process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
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
          const tools = (event as Record<string, unknown>).tools as
            | Array<Record<string, unknown>>
            | undefined;
          const eventRunId =
            ((event as Record<string, unknown>).run_id as string) ?? runId;
          if (tools && tools.length > 0 && options?.resourceId) {
            writePausedRun({
              agent_id: options.resourceId,
              run_id: eventRunId ?? "unknown",
              session_id: sessionId,
              resource_type: resourceType,
              paused_at: new Date().toISOString(),
              tools: tools as PausedRunState["tools"],
            });
            displayPausedToolInfo(
              tools,
              options.resourceId,
              eventRunId ?? "unknown",
            );
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
}

export async function handleNonStreamRun(
  cmd: Command,
  runFn: () => Promise<unknown>,
  options?: { resourceType?: ResourceType; resourceId?: string },
): Promise<void> {
  const format = getOutputFormat(cmd);

  const ora = (await import("ora")).default;
  const spinner = ora({ text: "Running...", stream: process.stderr }).start();

  try {
    const result = await runFn();
    spinner.stop();

    const resultObj = result as Record<string, unknown>;
    const statusStr =
      typeof resultObj?.status === "string"
        ? resultObj.status.toLowerCase()
        : "";
    const isPaused = resultObj?.is_paused === true || statusStr === "paused";
    const tools = resultObj?.tools as
      | Array<Record<string, unknown>>
      | undefined;
    if (
      isPaused &&
      tools &&
      tools.length > 0 &&
      options?.resourceId &&
      options?.resourceType === "agent"
    ) {
      const pausedRunId = (resultObj?.run_id as string) ?? "unknown";
      const pausedSessionId = (resultObj?.session_id as string) ?? null;
      writePausedRun({
        agent_id: options.resourceId,
        run_id: pausedRunId,
        session_id: pausedSessionId,
        resource_type: options.resourceType,
        paused_at: new Date().toISOString(),
        tools: tools as PausedRunState["tools"],
      });
      if (format !== "json") {
        displayPausedToolInfo(tools, options.resourceId, pausedRunId);
      }
    }

    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
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
  } catch (err) {
    spinner.stop();
    throw err;
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
