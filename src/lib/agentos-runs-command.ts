import type { AgentOSClient } from "@worksofadam/agentos-sdk";
import chalk from "chalk";
import type { Command } from "commander";
import { urlContext } from "./agentos-client.js";
import { getClient } from "./agentos-client.js";
import {
  type BackgroundRunStart,
  PATH_PREFIX,
  buildConfirmPayload,
  exitCodeForStatus,
  isFinishedStatus,
  pollBackgroundRun,
} from "./agentos-background.js";
import {
  listBackgroundRuns,
  readBackgroundRun,
  updateBackgroundRunStatus,
} from "./agentos-background-runs.js";
import { handleError } from "./agentos-errors.js";
import {
  getOutputFormat,
  outputList,
  printJson,
  writeError,
  writeWarning,
} from "./agentos-output.js";
import { mergePausedRun } from "./agentos-paused-runs.js";
import {
  EXIT_CODE_PAUSED,
  type ResourceType,
  type StreamRunResult,
  displayPausedToolInfo,
  extractPendingTools,
  projectCompact,
} from "./agentos-stream.js";

// Shared implementation of the `<resource> runs` command (list / poll /
// watch) plus the auto-confirm watch loop and the start-output helper.
// Wired into agents/teams/workflows via `runsAction(kind)`.

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function resourceLabel(kind: ResourceType): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Human-readable age from an ISO timestamp ("12m", "3h", "2d"). */
function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

/** Continue a paused run with a confirmed-tools payload (non-streaming). */
async function continueRun(
  client: AgentOSClient,
  kind: ResourceType,
  resourceId: string,
  runId: string,
  toolsPayload: string,
  sessionId?: string,
): Promise<void> {
  const opts = { tools: toolsPayload, sessionId, stream: false as const };
  if (kind === "agent") {
    await client.agents.continue(resourceId, runId, opts);
  } else if (kind === "team") {
    await client.teams.continue(resourceId, runId, opts);
  } else {
    await client.workflows.continue(resourceId, runId, opts);
  }
}

/**
 * Summarize a non-streaming run result into the paused-or-not shape, so a
 * foreground `--bypass-confirmations` run can decide whether to drive.
 */
export function pausedSummary(
  obj: Record<string, unknown> | null | undefined,
): StreamRunResult {
  const status =
    typeof obj?.status === "string" ? obj.status.toLowerCase() : "";
  return {
    paused: obj?.is_paused === true || status === "paused",
    runId: (obj?.run_id as string | undefined) ?? null,
    sessionId: (obj?.session_id as string | undefined) ?? null,
  };
}

/** Print a polled run per the active output format. Data → stdout. */
function emitRunResult(cmd: Command, run: Record<string, unknown>): void {
  const format = getOutputFormat(cmd);
  if (format === "json") {
    printJson(run);
    return;
  }
  if (format === "compact") {
    printJson(projectCompact(run, extractPendingTools(run)));
    return;
  }
  process.stdout.write(`status: ${String(run.status ?? "unknown")}\n`);
  const content = run.content;
  if (content != null && content !== "") {
    process.stdout.write(
      `${typeof content === "string" ? content : JSON.stringify(content, null, 2)}\n`,
    );
  }
}

/**
 * Print the `{run_id,...}` metadata of a freshly dispatched background run
 * (stdout) plus next-step hints (stderr).
 */
export function emitBackgroundStart(
  kind: ResourceType,
  start: BackgroundRunStart,
  bypass: boolean,
): void {
  printJson({
    run_id: start.run_id,
    session_id: start.session_id,
    status: start.status,
  });
  const plural = PATH_PREFIX[kind];
  process.stderr.write(chalk.dim("\nRun started in background.\n"));
  process.stderr.write(
    chalk.dim(`  Poll:   ixora ${plural} runs ${start.run_id}\n`),
  );
  if (bypass) {
    process.stderr.write(
      chalk.dim("  Drive to completion (auto-confirming tools):\n"),
    );
    process.stderr.write(
      chalk.dim(
        `    nohup ixora ${plural} runs ${start.run_id} --watch > ${start.run_id}.log 2>&1 &\n`,
      ),
    );
  } else {
    process.stderr.write(
      chalk.dim(`  Watch:  ixora ${plural} runs ${start.run_id} --watch\n`),
    );
  }
}

/**
 * Surface a paused run that won't be auto-confirmed: cache the pending tools
 * (agents only — `continue --confirm` reads that cache) and print next-step
 * hints to stderr.
 */
function surfacePausedRun(
  kind: ResourceType,
  resourceId: string,
  runId: string,
  sessionId: string | null,
  tools: ReturnType<typeof extractPendingTools>,
  prompt?: string,
): void {
  if (tools.length === 0) {
    writeWarning(
      "Run paused but no pending tool calls could be extracted from the response.",
    );
    return;
  }
  if (kind === "agent") {
    mergePausedRun({
      agent_id: resourceId,
      run_id: runId,
      session_id: sessionId,
      resource_type: kind,
      paused_at: new Date().toISOString(),
      prompt,
      tools,
    });
    displayPausedToolInfo(
      tools as unknown as Array<Record<string, unknown>>,
      resourceId,
      runId,
    );
    return;
  }
  // Teams/workflows have no paused-run cache; point at the watch driver.
  process.stderr.write(
    `\n${chalk.yellow.bold(`[Run Paused -- ${tools.length} tool call(s) need confirmation]`)}\n`,
  );
  for (const tool of tools) {
    process.stderr.write(`  Tool: ${chalk.cyan(String(tool.tool_name))}\n`);
  }
  process.stderr.write(
    `${chalk.dim(`Resolve with \`ixora ${PATH_PREFIX[kind]} continue ${resourceId} ${runId} "<tool results>"\`, or re-run the task with --bypass-confirmations to auto-approve.`)}\n`,
  );
}

/**
 * Poll a run until it reaches a terminal status. With `bypass`, auto-approves
 * every pause and continues; without it, stops at the first pause (exit 4).
 * Used by `runs --watch` and by foreground `run --bypass-confirmations`.
 */
export async function watchRun(
  client: AgentOSClient,
  cmd: Command,
  kind: ResourceType,
  ctx: { resourceId: string; runId: string; sessionId?: string; prompt?: string },
  opts: { bypass: boolean; intervalMs: number },
): Promise<void> {
  const { resourceId, runId } = ctx;
  let sessionId = ctx.sessionId;

  for (;;) {
    const run = await pollBackgroundRun(
      client,
      kind,
      resourceId,
      runId,
      sessionId,
    );
    const status = String(run.status ?? "UNKNOWN");
    const polledSession =
      typeof run.session_id === "string" ? run.session_id : undefined;
    if (polledSession) sessionId = polledSession;
    updateBackgroundRunStatus(runId, status, polledSession);

    if (isFinishedStatus(status)) {
      emitRunResult(cmd, run);
      process.exitCode = exitCodeForStatus(status);
      return;
    }

    if (status.toUpperCase() === "PAUSED") {
      const tools = extractPendingTools(run);
      if (opts.bypass && tools.length > 0) {
        process.stderr.write(
          chalk.dim(
            `[poll] status=PAUSED  ->  auto-confirmed ${tools.length} tool(s): ${tools
              .map((t) => t.tool_name)
              .join(", ")}\n`,
          ),
        );
        await continueRun(
          client,
          kind,
          resourceId,
          runId,
          buildConfirmPayload(tools as unknown as Array<Record<string, unknown>>),
          sessionId,
        );
        continue;
      }
      surfacePausedRun(kind, resourceId, runId, sessionId ?? null, tools, ctx.prompt);
      emitRunResult(cmd, run);
      process.exitCode = EXIT_CODE_PAUSED;
      return;
    }

    // RUNNING / PENDING
    process.stderr.write(chalk.dim(`[poll] status=${status}\n`));
    await sleep(opts.intervalMs);
  }
}

/**
 * Build the `<resource> runs [run_id]` command action for the given kind.
 * No arg → list cached background runs; with arg → poll (or `--watch`).
 */
export function runsAction(
  kind: ResourceType,
): (
  runId: string | undefined,
  options: Record<string, unknown>,
  cmd: Command,
) => Promise<void> {
  return async (runId, options, cmd) => {
    try {
      // List mode
      if (!runId) {
        const statusFilter =
          typeof options.status === "string"
            ? options.status.toUpperCase()
            : undefined;
        const runs = listBackgroundRuns()
          .filter((r) => r.resource_type === kind)
          .filter(
            (r) => !statusFilter || r.status.toUpperCase() === statusFilter,
          );
        outputList(
          cmd,
          runs.map((r) => ({
            run_id: r.run_id,
            resource_id: r.resource_id,
            status: r.status,
            age: ageString(r.started_at),
            prompt: r.prompt,
          })),
          {
            columns: ["RUN ID", "RESOURCE", "STATUS", "AGE", "PROMPT"],
            keys: ["run_id", "resource_id", "status", "age", "prompt"],
            meta: {
              page: 1,
              limit: runs.length,
              total_pages: 1,
              total_count: runs.length,
            },
          },
        );
        return;
      }

      // Poll / watch mode
      const watch = Boolean(options.watch);

      const cached = readBackgroundRun(runId);
      if (!cached) {
        writeError(
          `No cached background run for ${runId}. It may have expired (7-day cache) or been started on another machine.`,
        );
        process.exitCode = 1;
        return;
      }
      if (cached.resource_type !== kind) {
        writeError(
          `Run ${runId} is a ${cached.resource_type} run — use \`ixora ${PATH_PREFIX[cached.resource_type]} runs ${runId}\`.`,
        );
        process.exitCode = 1;
        return;
      }

      const client = getClient(cmd);
      const sessionId =
        (typeof options.sessionId === "string"
          ? options.sessionId
          : undefined) ??
        cached.session_id ??
        undefined;
      // --bypass-confirmations is a creation-time flag on `run`; `runs --watch`
      // honors the intent recorded on the run but cannot set it.
      const bypass = cached.bypass_confirmations;
      const intervalMs = Math.max(1, Number(options.interval) || 3) * 1000;

      if (watch) {
        await watchRun(
          client,
          cmd,
          kind,
          {
            resourceId: cached.resource_id,
            runId,
            sessionId,
            prompt: cached.prompt,
          },
          { bypass, intervalMs },
        );
        return;
      }

      // Single poll
      const run = await pollBackgroundRun(
        client,
        kind,
        cached.resource_id,
        runId,
        sessionId,
      );
      const status = String(run.status ?? "UNKNOWN");
      updateBackgroundRunStatus(
        runId,
        status,
        typeof run.session_id === "string" ? run.session_id : undefined,
      );
      if (status.toUpperCase() === "PAUSED") {
        surfacePausedRun(
          kind,
          cached.resource_id,
          runId,
          (typeof run.session_id === "string" ? run.session_id : null) ??
            sessionId ??
            null,
          extractPendingTools(run),
          cached.prompt,
        );
      }
      emitRunResult(cmd, run);
      process.exitCode = exitCodeForStatus(status);
    } catch (err) {
      handleError(err, {
        resource: resourceLabel(kind),
        identifier: runId,
        listCommand: `ixora ${PATH_PREFIX[kind]} list`,
        ...urlContext(cmd),
      });
    }
  };
}
