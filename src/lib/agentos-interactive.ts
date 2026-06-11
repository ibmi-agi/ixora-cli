// Inquirer-based interactive resume loop for paused agent runs. Extracted
// from src/agentos/agents.ts so the approve/reject fallback path is reusable
// without dragging in the whole agents command tree.

import type { AgentOSClient, AgentStream } from "@worksofadam/agentos-sdk";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import {
  buildConfirmPayload,
  buildRejectPayload,
} from "./agentos-background.js";
import { writeWarning } from "./agentos-output.js";
import { deletePausedRun } from "./agentos-paused-runs.js";
import type { PausedRunState } from "./agentos-paused-runs.js";
import { displayPausedToolInfo, handleStreamRun } from "./agentos-stream.js";

/**
 * Inline approve/reject loop for paused runs. Spawned by `--interactive`.
 * Loops the prompt across re-pauses so multi-turn HITL flows stay in a
 * single terminal session — no copy-paste, no run_id juggling, no
 * --session-id hunting.
 *
 * Quitting leaves the cache intact; the user can pick up later with
 * `ixora agents continue <run_id> --confirm`.
 */
export async function interactiveResume(
  client: AgentOSClient,
  cmd: Command,
  ctx: {
    agentId: string;
    runId: string;
    sessionId: string | null;
    pendingTools: PausedRunState["tools"];
    userId?: string;
  },
): Promise<void> {
  if (!process.stdin.isTTY) {
    writeWarning(
      "Skipping interactive resume: stdin is not a TTY. Re-run with `agents continue --confirm --stream`.",
    );
    return;
  }
  let { runId, sessionId, pendingTools } = ctx;
  while (true) {
    const choice = await select<string>({
      message: chalk.yellow.bold(
        `[Run paused] ${pendingTools.length} tool call(s) require confirmation`,
      ),
      choices: [
        { name: "Approve all", value: "approve" },
        { name: "Reject all", value: "reject" },
        { name: "Show details", value: "show" },
        { name: "Quit (cache preserved)", value: "quit" },
      ],
    });

    if (choice === "show") {
      displayPausedToolInfo(
        pendingTools as unknown as Array<Record<string, unknown>>,
        ctx.agentId,
        runId,
      );
      continue;
    }
    if (choice === "quit") {
      process.stderr.write(
        `${chalk.dim("Cache preserved. Resume with:")} ixora agents continue ${runId} --confirm --stream\n`,
      );
      return;
    }

    const tools =
      choice === "approve"
        ? buildConfirmPayload(
            pendingTools as unknown as Array<Record<string, unknown>>,
          )
        : buildRejectPayload(
            pendingTools as unknown as Array<Record<string, unknown>>,
          );

    const stream = await client.agents.continue(ctx.agentId, runId, {
      tools,
      sessionId: sessionId ?? undefined,
      userId: ctx.userId,
      stream: true,
    });
    const next = await handleStreamRun(cmd, stream as AgentStream, "agent", {
      resourceId: ctx.agentId,
    });
    if (!next.paused) {
      // Resolved cleanly — clear the cache and exit the loop. The exit code
      // set by handleStreamRun (4 on pause) gets cleared because the final
      // outcome is success.
      deletePausedRun(runId);
      process.exitCode = 0;
      return;
    }
    // Re-paused — feed new pending state back into the loop.
    runId = next.runId ?? runId;
    sessionId = next.sessionId ?? sessionId;
    pendingTools = next.pendingTools ?? [];
    if (pendingTools.length === 0) {
      writeWarning(
        "Run re-paused but no pending tool calls were extracted; exiting interactive loop.",
      );
      return;
    }
  }
}
