import type { AgentStream } from "@worksofadam/agentos-sdk";
import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  writeError,
  writeSuccess,
} from "../lib/agentos-output.js";
import {
  deletePausedRun,
  readPausedRun,
} from "../lib/agentos-paused-runs.js";
import { handleNonStreamRun, handleStreamRun } from "../lib/agentos-stream.js";

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
  .action(async (agentId: string, message: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      if (options.stream) {
        const stream = await client.agents.runStream(agentId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        await handleStreamRun(cmd, stream, "agent", { resourceId: agentId });
      } else {
        await handleNonStreamRun(
          cmd,
          () =>
            client.agents.run(agentId, {
              message,
              sessionId: options.sessionId,
              userId: options.userId,
            }),
          { resourceType: "agent", resourceId: agentId },
        );
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
  .argument("<agent_id>", "Agent ID")
  .argument("<run_id>", "Run ID to continue")
  .argument(
    "[tool_results]",
    "Tool results JSON (optional when using --confirm or --reject)",
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
  .action(
    async (
      agentId: string,
      runId: string,
      toolResults: string | undefined,
      options,
      cmd,
    ) => {
      try {
        const client = getClient(cmd);
        let tools: string;
        let sessionId = options.sessionId as string | undefined;

        if (options.confirm) {
          const cached = readPausedRun(runId);
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. Provide tool results JSON directly or re-run the agent with --stream to capture the paused state.`,
            );
            process.exitCode = 1;
            return;
          }
          tools = buildConfirmPayload(cached.tools);
          if (!sessionId && cached.session_id) {
            sessionId = cached.session_id;
          }
        } else if (options.reject !== undefined) {
          const cached = readPausedRun(runId);
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. Provide tool results JSON directly or re-run the agent with --stream to capture the paused state.`,
            );
            process.exitCode = 1;
            return;
          }
          const note =
            typeof options.reject === "string" ? options.reject : undefined;
          tools = buildRejectPayload(cached.tools, note);
          if (!sessionId && cached.session_id) {
            sessionId = cached.session_id;
          }
        } else if (toolResults) {
          tools = toolResults;
        } else {
          writeError(
            "Provide tool results JSON, or use --confirm/--reject for a paused tool call.",
          );
          process.exitCode = 1;
          return;
        }

        if (options.stream) {
          const stream = await client.agents.continue(agentId, runId, {
            tools,
            sessionId,
            userId: options.userId,
            stream: true,
          });
          await handleStreamRun(cmd, stream as AgentStream, "agent", {
            resourceId: agentId,
          });
        } else {
          const result = await client.agents.continue(agentId, runId, {
            tools,
            sessionId,
            userId: options.userId,
            stream: false,
          });
          const format = getOutputFormat(cmd);
          if (format === "json") {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            const content = (result as Record<string, unknown>).content;
            if (content) {
              process.stdout.write(
                `${typeof content === "string" ? content : JSON.stringify(content, null, 2)}\n`,
              );
            }
          }
        }

        if (options.confirm || options.reject !== undefined) {
          deletePausedRun(runId);
        }
      } catch (err) {
        handleError(err, { resource: "Agent", url: getBaseUrl(cmd) });
      }
    },
  );

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
