import type { AgentOSClient, AgentStream } from "@worksofadam/agentos-sdk";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  writeError,
  writeSuccess,
  writeWarning,
} from "../lib/agentos-output.js";
import {
  deletePausedRun,
  listPausedRuns,
  readPausedRun,
} from "../lib/agentos-paused-runs.js";
import type { PausedRunState } from "../lib/agentos-paused-runs.js";
import { requestResumeStream } from "../lib/agentos-resume.js";
import {
  displayPausedToolInfo,
  EXIT_CODE_PAUSED,
  handleNonStreamRun,
  handleStreamRun,
  type StreamRunResult,
} from "../lib/agentos-stream.js";

export const agentsCommand = new Command("agents").description("Manage agents");

agentsCommand
  .command("list")
  .description("List all agents")
  .option(
    "--limit <n>",
    "Results per page",
    (v: string) => Number.parseInt(v, 10),
    20,
  )
  .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10), 1)
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const agents = await client.agents.list();

      const limit = opts.limit as number;
      const page = opts.page as number;
      const start = (page - 1) * limit;
      const paged = agents.slice(start, start + limit);
      const meta = {
        page,
        limit,
        total_pages: Math.ceil(agents.length / limit),
        total_count: agents.length,
      };

      outputList(cmd, paged as unknown as Record<string, unknown>[], {
        columns: ["ID", "NAME", "DESCRIPTION"],
        keys: ["id", "name", "description"],
        meta,
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

agentsCommand
  .command("get")
  .argument("<agent_id>", "Agent ID")
  .description("Get agent details")
  .action(async (agentId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const agent = await client.agents.get(agentId);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, agent as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const modelDisplay = agent.model?.model ?? agent.model?.name ?? "N/A";
      outputDetail(
        cmd,
        {
          id: agent.id ?? "",
          name: agent.name ?? "",
          description: agent.description ?? "",
          model: modelDisplay,
        },
        {
          labels: ["ID", "Name", "Description", "Model"],
          keys: ["id", "name", "description", "model"],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
    }
  });

agentsCommand
  .command("run")
  .argument("<agent_id>", "Agent ID")
  .argument("<message>", "Message to send to the agent")
  .description("Run an agent with a message")
  .option("--stream", "Stream the response via SSE")
  .option("--session-id <id>", "Session ID for conversation context")
  .option("--user-id <id>", "User ID for personalization")
  .option(
    "-i, --interactive",
    "Prompt for approve/reject inline when the run pauses (requires --stream and a TTY)",
  )
  .action(async (agentId: string, message: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      let result: StreamRunResult | undefined;
      if (options.stream) {
        const stream = await client.agents.runStream(agentId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        result = await handleStreamRun(cmd, stream, "agent", {
          resourceId: agentId,
          prompt: message,
        });
      } else {
        await handleNonStreamRun(
          cmd,
          () =>
            client.agents.run(agentId, {
              message,
              sessionId: options.sessionId,
              userId: options.userId,
            }),
          { resourceType: "agent", resourceId: agentId, prompt: message },
        );
      }
      if (
        options.interactive &&
        options.stream &&
        result?.paused &&
        result.runId
      ) {
        await interactiveResume(client, cmd, {
          agentId,
          runId: result.runId,
          sessionId: result.sessionId ?? null,
          pendingTools: result.pendingTools ?? [],
          userId: options.userId,
        });
      }
    } catch (err) {
      handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
    }
  });

function buildConfirmPayload(tools: Array<Record<string, unknown>>): string {
  const confirmed = tools.map((tool) => ({
    ...tool,
    confirmed: true,
  }));
  return JSON.stringify(confirmed);
}

function buildRejectPayload(
  tools: Array<Record<string, unknown>>,
  note?: string,
): string {
  const rejected = tools.map((tool) => ({
    ...tool,
    confirmed: false,
    confirmation_note: note ?? "Rejected via CLI",
  }));
  return JSON.stringify(rejected);
}

agentsCommand
  .command("continue")
  // The two positionals were originally <agent_id> <run_id>. We now accept
  // either form so users with only the run_id in their scrollback don't
  // have to dig for the agent_id:
  //   ixora agents continue <agent_id> <run_id> [tool_results]   (legacy)
  //   ixora agents continue <run_id>          [tool_results]    (cache lookup)
  // Both positionals are optional in the schema; the action validates and
  // looks up agent_id from ~/.ixora/agentos-paused-runs/<run_id>.json when
  // omitted.
  .argument(
    "[arg1]",
    "agent_id (legacy 2-positional form) OR run_id (cache form)",
  )
  .argument(
    "[arg2]",
    "run_id (when arg1 is agent_id) OR tool_results JSON (cache form)",
  )
  .argument(
    "[tool_results]",
    "Tool results JSON (3-positional form). Optional with --confirm/--reject.",
  )
  .description("Continue an agent run")
  .option("--stream", "Stream the response via SSE")
  .option(
    "--confirm",
    "Confirm the paused tool call (auto-reconstruct payload from cache)",
  )
  .option("--reject [note]", "Reject the paused tool call with optional note")
  .option("--session-id <id>", "Session ID")
  .option("--user-id <id>", "User ID")
  .option(
    "-i, --interactive",
    "Re-prompt for approve/reject inline if the continued run re-pauses (requires --stream)",
  )
  .action(
    async (
      arg1: string | undefined,
      arg2: string | undefined,
      arg3: string | undefined,
      options,
      cmd,
    ) => {
      try {
        const client = getClient(cmd);

        const parsed = parseContinuePositionals(arg1, arg2, arg3);
        if (!parsed.runId) {
          writeError(
            "Provide a run_id (and optionally agent_id). See `ixora agents continue --help`.",
          );
          process.exitCode = 1;
          return;
        }
        let { agentId, runId, toolResults } = parsed;

        let cached: PausedRunState | null = null;
        if (!agentId || options.confirm || options.reject !== undefined) {
          cached = readPausedRun(runId);
        }
        if (!agentId) {
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. Pass agent_id explicitly: ixora agents continue <agent_id> ${runId}`,
            );
            process.exitCode = 1;
            return;
          }
          agentId = cached.agent_id;
        }

        let tools: string;
        let sessionId = options.sessionId as string | undefined;

        if (options.confirm) {
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. The cache may have expired (>24h) or this run was never paused.`,
            );
            process.exitCode = 1;
            return;
          }
          tools = buildConfirmPayload(cached.tools);
          if (!sessionId && cached.session_id) sessionId = cached.session_id;
        } else if (options.reject !== undefined) {
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. The cache may have expired (>24h) or this run was never paused.`,
            );
            process.exitCode = 1;
            return;
          }
          const note =
            typeof options.reject === "string" ? options.reject : undefined;
          tools = buildRejectPayload(cached.tools, note);
          if (!sessionId && cached.session_id) sessionId = cached.session_id;
        } else if (toolResults) {
          tools = toolResults;
        } else {
          writeError(
            "Provide tool results JSON, or use --confirm/--reject for a paused tool call.",
          );
          process.exitCode = 1;
          return;
        }

        let rePaused = false;
        let streamResult: StreamRunResult | undefined;
        if (options.stream) {
          const stream = await client.agents.continue(agentId, runId, {
            tools,
            sessionId,
            userId: options.userId,
            stream: true,
          });
          streamResult = await handleStreamRun(
            cmd,
            stream as AgentStream,
            "agent",
            { resourceId: agentId, prompt: cached?.prompt },
          );
          rePaused = streamResult.paused;
        } else {
          const result = await client.agents.continue(agentId, runId, {
            tools,
            sessionId,
            userId: options.userId,
            stream: false,
          });
          const status =
            typeof (result as Record<string, unknown>)?.status === "string"
              ? ((result as Record<string, unknown>).status as string).toLowerCase()
              : "";
          rePaused = status === "paused";
          await handleNonStreamRun(
            cmd,
            { result },
            {
              resourceType: "agent",
              resourceId: agentId,
              prompt: cached?.prompt,
            },
          );
        }

        // Only delete the original cache once we're sure the continue resolved
        // the pause (didn't re-pause). For stream, we play it safe and let the
        // 24h TTL clean up stale entries.
        if ((options.confirm || options.reject !== undefined) && !rePaused) {
          deletePausedRun(runId);
        }

        if (
          options.interactive &&
          options.stream &&
          rePaused &&
          streamResult?.runId
        ) {
          await interactiveResume(client, cmd, {
            agentId,
            runId: streamResult.runId,
            sessionId: streamResult.sessionId ?? null,
            pendingTools: streamResult.pendingTools ?? [],
            userId: options.userId,
          });
        }
      } catch (err) {
        handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
      }
    },
  );

agentsCommand
  .command("pending")
  .argument("[run_id]", "Show details for one paused run; omit to list all")
  .description("List runs paused awaiting tool confirmation")
  .action((runId: string | undefined, _options, cmd) => {
    try {
      if (runId) {
        const cached = readPausedRun(runId);
        if (!cached) {
          writeError(
            `No cached paused state for run ${runId}. The cache may have expired (>24h) or this run was never paused.`,
          );
          process.exitCode = 1;
          return;
        }
        const format = getOutputFormat(cmd);
        if (format === "json") {
          process.stdout.write(`${JSON.stringify(cached, null, 2)}\n`);
          return;
        }
        displayPausedToolInfo(
          cached.tools as unknown as Array<Record<string, unknown>>,
          cached.agent_id,
          cached.run_id,
        );
        if (cached.prompt) {
          process.stderr.write(
            `\n${chalk.dim("Original prompt:")} ${cached.prompt}\n`,
          );
        }
        return;
      }

      const all = listPausedRuns();
      const rows = all.map((s) => {
        const ageMs = Date.now() - new Date(s.paused_at ?? 0).getTime();
        const ageMin = Math.max(0, Math.round(ageMs / 60_000));
        return {
          run_id: s.run_id,
          agent_id: s.agent_id,
          age: ageMin >= 60 ? `${Math.round(ageMin / 60)}h` : `${ageMin}m`,
          tools: s.tools.length,
          tool_names: s.tools.map((t) => t.tool_name).join(", "),
        };
      });
      outputList(cmd, rows as unknown as Record<string, unknown>[], {
        columns: ["RUN ID", "AGENT", "AGE", "TOOLS", "TOOL NAMES"],
        keys: ["run_id", "agent_id", "age", "tools", "tool_names"],
        meta: { page: 1, limit: rows.length, total_pages: 1, total_count: rows.length },
      });
      if (rows.length === 0) {
        process.stderr.write(
          `${chalk.dim("No paused runs. The cache lives at ~/.ixora/agentos-paused-runs/ (24h TTL).")}\n`,
        );
      } else {
        process.stderr.write(
          `\n${chalk.dim("Approve:")} ixora agents continue <RUN ID> --confirm --stream\n`,
        );
        process.stderr.write(
          `${chalk.dim("Reject: ")} ixora agents continue <RUN ID> --reject --stream\n`,
        );
      }
    } catch (err) {
      handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
    }
  });

agentsCommand
  .command("resume")
  .argument("<agent_id>", "Agent ID")
  .argument("<run_id>", "Run ID whose SSE stream you want to reconnect to")
  .description(
    "Resume an SSE stream for an agent run after disconnection (replays missed events)",
  )
  .option(
    "--last-event-index <n>",
    "Index of the last SSE event you received (0-based). Omit to replay from start.",
    (v: string) => Number.parseInt(v, 10),
  )
  .option(
    "--session-id <id>",
    "Session ID — required for database fallback when the run is no longer buffered",
  )
  .action(async (agentId: string, runId: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      const stream = await requestResumeStream(client, "agent", agentId, runId, {
        lastEventIndex: options.lastEventIndex,
        sessionId: options.sessionId,
      });
      await handleStreamRun(cmd, stream, "agent", { resourceId: agentId });
    } catch (err) {
      handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
    }
  });

agentsCommand
  .command("cancel")
  .argument("<agent_id>", "Agent ID")
  .argument("<run_id>", "Run ID to cancel")
  .description("Cancel an in-progress agent run")
  .action(async (agentId: string, runId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.agents.cancel(agentId, runId);
      writeSuccess(`Cancelled run ${runId} for agent ${agentId}`);
    } catch (err) {
      handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
    }
  });

/**
 * Disambiguate the variadic positional shape on `agents continue`. Returns
 * `{ agentId?, runId, toolResults? }`. The two-positional UUID-then-JSON
 * case is the only one that needs sniffing — everything else is unambiguous
 * by arity.
 */
export function parseContinuePositionals(
  a: string | undefined,
  b: string | undefined,
  c: string | undefined,
): {
  agentId?: string;
  runId?: string;
  toolResults?: string;
} {
  const args = [a, b, c].filter((x): x is string => typeof x === "string");
  if (args.length === 0) return {};
  if (args.length === 1) {
    return { runId: args[0] };
  }
  if (args.length === 2) {
    const second = args[1] ?? "";
    const looksLikeJson =
      second.startsWith("{") || second.startsWith("[") || second.startsWith('"');
    if (looksLikeJson) {
      return { runId: args[0], toolResults: second };
    }
    return { agentId: args[0], runId: second };
  }
  return { agentId: args[0], runId: args[1], toolResults: args[2] };
}

/**
 * Inline approve/reject loop for paused runs. Spawned by `--interactive`.
 * Loops the prompt across re-pauses so multi-turn HITL flows stay in a
 * single terminal session — no copy-paste, no run_id juggling, no
 * --session-id hunting.
 *
 * Quitting leaves the cache intact; the user can pick up later with
 * `ixora agents continue <run_id> --confirm`.
 */
async function interactiveResume(
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
