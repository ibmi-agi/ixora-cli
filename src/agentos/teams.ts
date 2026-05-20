import type { AgentStream } from "@worksofadam/agentos-sdk";
import { Command } from "commander";
import {
  getBaseUrl,
  getClient,
  urlContext,
} from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import { emitDryRunPlan, isDryRun } from "../lib/dry-run.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  writeError,
  writeSuccess,
} from "../lib/agentos-output.js";
import { requestResumeStream } from "../lib/agentos-resume.js";
import {
  handleNonStreamRun,
  handleStreamRun,
  type StreamRunResult,
} from "../lib/agentos-stream.js";
import { startBackgroundRun } from "../lib/agentos-background.js";
import { writeBackgroundRun } from "../lib/agentos-background-runs.js";
import {
  emitBackgroundStart,
  pausedSummary,
  runsAction,
  watchRun,
} from "../lib/agentos-runs-command.js";

export const teamsCommand = new Command("teams").description("Manage teams");

teamsCommand
  .command("list")
  .description("List all teams")
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
      const teams = await client.teams.list();

      const limit = opts.limit as number;
      const page = opts.page as number;
      const start = (page - 1) * limit;
      const paged = teams.slice(start, start + limit);
      const meta = {
        page,
        limit,
        total_pages: Math.ceil(teams.length / limit),
        total_count: teams.length,
      };

      outputList(cmd, paged as unknown as Record<string, unknown>[], {
        columns: ["ID", "NAME", "MODE", "DESCRIPTION"],
        keys: ["id", "name", "mode", "description"],
        meta,
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

teamsCommand
  .command("get")
  .argument("<team_id>", "Team ID")
  .description("Get team details")
  .action(async (teamId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const team = await client.teams.get(teamId);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, team as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const modelDisplay = team.model?.model ?? team.model?.name ?? "N/A";

      outputDetail(
        cmd,
        {
          id: team.id ?? "",
          name: team.name ?? "",
          mode: team.mode ?? "",
          description: team.description ?? "",
          model: modelDisplay,
        },
        {
          labels: ["ID", "Name", "Mode", "Description", "Model"],
          keys: ["id", "name", "mode", "description", "model"],
        },
      );
    } catch (err) {
      handleError(err, {
        resource: "Team",
        identifier: teamId,
        listCommand: "ixora teams list",
        ...urlContext(cmd),
      });
    }
  });

teamsCommand
  .command("run")
  .argument("<team_id>", "Team ID")
  .argument("<message>", "Message to send to the team")
  .description("Run a team with a message")
  .option("--stream", "Stream the response via SSE")
  .option("--session-id <id>", "Session ID for conversation context")
  .option("--user-id <id>", "User ID for personalization")
  .option(
    "--background",
    "Dispatch the run server-side and return immediately (requires a database)",
  )
  .option(
    "--bypass-confirmations",
    "Auto-approve any tool calls that require confirmation",
  )
  .option(
    "--dry-run",
    "Verify the team exists and emit the request payload as JSON without running",
  )
  .action(async (teamId: string, message: string, options, cmd) => {
    try {
      if (options.background && options.stream) {
        writeError(
          "--background and --stream are mutually exclusive — background runs are fire-and-forget.",
        );
        process.exitCode = 1;
        return;
      }
      const client = getClient(cmd);
      if (isDryRun(cmd)) {
        await client.teams.get(teamId);
        emitDryRunPlan({
          action: options.background ? "teams.run.background" : "teams.run",
          target: teamId,
          payload: {
            message,
            session_id: options.sessionId,
            user_id: options.userId,
            stream: options.background ? false : Boolean(options.stream),
            background: Boolean(options.background),
            bypass_confirmations: Boolean(options.bypassConfirmations),
          },
        });
        return;
      }

      if (options.background) {
        const start = await startBackgroundRun(client, "team", teamId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        writeBackgroundRun({
          run_id: start.run_id,
          resource_type: "team",
          resource_id: teamId,
          session_id: start.session_id,
          status: start.status,
          prompt: message,
          started_at: new Date().toISOString(),
          bypass_confirmations: Boolean(options.bypassConfirmations),
        });
        emitBackgroundStart(
          "team",
          start,
          Boolean(options.bypassConfirmations),
        );
        return;
      }

      let result: StreamRunResult | undefined;
      if (options.stream) {
        const stream = await client.teams.runStream(teamId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        result = await handleStreamRun(cmd, stream, "team", {
          resourceId: teamId,
        });
      } else if (options.bypassConfirmations) {
        const runResult = await client.teams.run(teamId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        await handleNonStreamRun(
          cmd,
          { result: runResult },
          { resourceType: "team", resourceId: teamId },
        );
        result = pausedSummary(runResult as Record<string, unknown>);
      } else {
        await handleNonStreamRun(
          cmd,
          () =>
            client.teams.run(teamId, {
              message,
              sessionId: options.sessionId,
              userId: options.userId,
            }),
          { resourceType: "team", resourceId: teamId },
        );
      }

      if (result?.paused && result.runId && options.bypassConfirmations) {
        await watchRun(
          client,
          cmd,
          "team",
          {
            resourceId: teamId,
            runId: result.runId,
            sessionId: result.sessionId ?? undefined,
          },
          { bypass: true, intervalMs: 3000 },
        );
      }
    } catch (err) {
      handleError(err, {
        resource: "Team",
        identifier: teamId,
        listCommand: "ixora teams list",
        ...urlContext(cmd),
      });
    }
  });

teamsCommand
  .command("runs")
  .argument(
    "[run_id]",
    "Poll one background run; omit to list cached background runs",
  )
  .description("List background runs, or poll/watch one")
  .option("--watch", "Poll until the run reaches a terminal status")
  .option("--status <status>", "Filter the list by status")
  .option(
    "--interval <seconds>",
    "Poll interval for --watch",
    (v: string) => Number.parseInt(v, 10),
    3,
  )
  .option(
    "--session-id <id>",
    "Session ID override (when the cached run has none)",
  )
  .action(runsAction("team"));

teamsCommand
  .command("continue")
  .argument("<team_id>", "Team ID")
  .argument("<run_id>", "Run ID to continue")
  .argument("<message>", "Message to continue with")
  .description("Continue a team run")
  .option("--stream", "Stream the response via SSE")
  .option("--session-id <id>", "Session ID")
  .option("--user-id <id>", "User ID")
  .action(
    async (
      teamId: string,
      runId: string,
      message: string,
      options,
      cmd,
    ) => {
      try {
        const client = getClient(cmd);
        if (options.stream) {
          const stream = await client.teams.continue(teamId, runId, {
            tools: message,
            sessionId: options.sessionId,
            userId: options.userId,
            stream: true,
          });
          await handleStreamRun(cmd, stream as AgentStream, "team", {
            resourceId: teamId,
          });
        } else {
          const result = await client.teams.continue(teamId, runId, {
            tools: message,
            sessionId: options.sessionId,
            userId: options.userId,
            stream: false,
          });
          await handleNonStreamRun(
            cmd,
            { result },
            { resourceType: "team", resourceId: teamId },
          );
        }
      } catch (err) {
        handleError(err, {
          resource: "Team",
          identifier: teamId,
          listCommand: "ixora teams list",
          ...urlContext(cmd),
        });
      }
    },
  );

teamsCommand
  .command("resume")
  .argument("<team_id>", "Team ID")
  .argument("<run_id>", "Run ID whose SSE stream you want to reconnect to")
  .description(
    "Resume an SSE stream for a team run after disconnection (replays missed events)",
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
  .action(async (teamId: string, runId: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      const stream = await requestResumeStream(client, "team", teamId, runId, {
        lastEventIndex: options.lastEventIndex,
        sessionId: options.sessionId,
      });
      await handleStreamRun(cmd, stream, "team", { resourceId: teamId });
    } catch (err) {
      handleError(err, {
        resource: "Team",
        identifier: teamId,
        listCommand: "ixora teams list",
        ...urlContext(cmd),
      });
    }
  });

teamsCommand
  .command("cancel")
  .argument("<team_id>", "Team ID")
  .argument("<run_id>", "Run ID to cancel")
  .description("Cancel an in-progress team run")
  .option(
    "--dry-run",
    "Verify the team exists and emit the plan as JSON without cancelling",
  )
  .action(async (teamId: string, runId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      if (isDryRun(cmd)) {
        await client.teams.get(teamId);
        emitDryRunPlan({
          action: "teams.cancel",
          target: teamId,
          payload: { run_id: runId },
        });
        return;
      }
      await client.teams.cancel(teamId, runId);
      writeSuccess(`Cancelled run ${runId} for team ${teamId}`);
    } catch (err) {
      handleError(err, {
        resource: "Team",
        identifier: teamId,
        listCommand: "ixora teams list",
        ...urlContext(cmd),
      });
    }
  });
