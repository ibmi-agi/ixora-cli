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

export const workflowsCommand = new Command("workflows").description(
  "Manage workflows",
);

workflowsCommand
  .command("list")
  .description("List all workflows")
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
      const workflows = await client.workflows.list();

      const limit = opts.limit as number;
      const page = opts.page as number;
      const start = (page - 1) * limit;
      const paged = workflows.slice(start, start + limit);
      const meta = {
        page,
        limit,
        total_pages: Math.ceil(workflows.length / limit),
        total_count: workflows.length,
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

workflowsCommand
  .command("get")
  .argument("<workflow_id>", "Workflow ID")
  .description("Get workflow details")
  .action(async (workflowId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const workflow = await client.workflows.get(workflowId);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, workflow as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      outputDetail(
        cmd,
        {
          id: workflow.id ?? "",
          name: workflow.name ?? "",
          description: workflow.description ?? "",
          steps: Array.isArray(workflow.steps) ? workflow.steps.length : 0,
          workflow_agent: workflow.workflow_agent ? "Yes" : "No",
        },
        {
          labels: ["ID", "Name", "Description", "Steps", "Workflow Agent"],
          keys: ["id", "name", "description", "steps", "workflow_agent"],
        },
      );
    } catch (err) {
      handleError(err, {
        resource: "Workflow",
        identifier: workflowId,
        listCommand: "ixora workflows list",
        ...urlContext(cmd),
      });
    }
  });

workflowsCommand
  .command("run")
  .argument("<workflow_id>", "Workflow ID")
  .argument("<message>", "Message to send to the workflow")
  .description("Run a workflow with a message")
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
    "Verify the workflow exists and emit the request payload as JSON without running",
  )
  .action(async (workflowId: string, message: string, options, cmd) => {
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
        await client.workflows.get(workflowId);
        emitDryRunPlan({
          action: options.background
            ? "workflows.run.background"
            : "workflows.run",
          target: workflowId,
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
        const start = await startBackgroundRun(client, "workflow", workflowId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        writeBackgroundRun({
          run_id: start.run_id,
          resource_type: "workflow",
          resource_id: workflowId,
          session_id: start.session_id,
          status: start.status,
          prompt: message,
          started_at: new Date().toISOString(),
          bypass_confirmations: Boolean(options.bypassConfirmations),
        });
        emitBackgroundStart(
          "workflow",
          start,
          Boolean(options.bypassConfirmations),
        );
        return;
      }

      let result: StreamRunResult | undefined;
      if (options.stream) {
        const stream = await client.workflows.runStream(workflowId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        result = await handleStreamRun(cmd, stream, "workflow", {
          resourceId: workflowId,
        });
      } else if (options.bypassConfirmations) {
        const runResult = await client.workflows.run(workflowId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        await handleNonStreamRun(
          cmd,
          { result: runResult },
          { resourceType: "workflow", resourceId: workflowId },
        );
        result = pausedSummary(runResult as Record<string, unknown>);
      } else {
        await handleNonStreamRun(
          cmd,
          () =>
            client.workflows.run(workflowId, {
              message,
              sessionId: options.sessionId,
              userId: options.userId,
            }),
          { resourceType: "workflow", resourceId: workflowId },
        );
      }

      if (result?.paused && result.runId && options.bypassConfirmations) {
        await watchRun(
          client,
          cmd,
          "workflow",
          {
            resourceId: workflowId,
            runId: result.runId,
            sessionId: result.sessionId ?? undefined,
          },
          { bypass: true, intervalMs: 3000 },
        );
      }
    } catch (err) {
      handleError(err, {
        resource: "Workflow",
        identifier: workflowId,
        listCommand: "ixora workflows list",
        ...urlContext(cmd),
      });
    }
  });

workflowsCommand
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
  .action(runsAction("workflow"));

workflowsCommand
  .command("continue")
  .argument("<workflow_id>", "Workflow ID")
  .argument("<run_id>", "Run ID to continue")
  .argument("<message>", "Message to continue with")
  .description("Continue a workflow run")
  .option("--stream", "Stream the response via SSE")
  .option("--session-id <id>", "Session ID")
  .option("--user-id <id>", "User ID")
  .action(
    async (
      workflowId: string,
      runId: string,
      message: string,
      options,
      cmd,
    ) => {
      try {
        const client = getClient(cmd);
        if (options.stream) {
          const stream = await client.workflows.continue(workflowId, runId, {
            tools: message,
            sessionId: options.sessionId,
            userId: options.userId,
            stream: true,
          });
          await handleStreamRun(cmd, stream as AgentStream, "workflow", {
            resourceId: workflowId,
          });
        } else {
          const result = await client.workflows.continue(workflowId, runId, {
            tools: message,
            sessionId: options.sessionId,
            userId: options.userId,
            stream: false,
          });
          await handleNonStreamRun(
            cmd,
            { result },
            { resourceType: "workflow", resourceId: workflowId },
          );
        }
      } catch (err) {
        handleError(err, {
          resource: "Workflow",
          identifier: workflowId,
          listCommand: "ixora workflows list",
          ...urlContext(cmd),
        });
      }
    },
  );

workflowsCommand
  .command("resume")
  .argument("<workflow_id>", "Workflow ID")
  .argument("<run_id>", "Run ID whose SSE stream you want to reconnect to")
  .description(
    "Resume an SSE stream for a workflow run after disconnection (replays missed events)",
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
  .action(async (workflowId: string, runId: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      const stream = await requestResumeStream(
        client,
        "workflow",
        workflowId,
        runId,
        {
          lastEventIndex: options.lastEventIndex,
          sessionId: options.sessionId,
        },
      );
      await handleStreamRun(cmd, stream, "workflow", {
        resourceId: workflowId,
      });
    } catch (err) {
      handleError(err, {
        resource: "Workflow",
        identifier: workflowId,
        listCommand: "ixora workflows list",
        ...urlContext(cmd),
      });
    }
  });

workflowsCommand
  .command("cancel")
  .argument("<workflow_id>", "Workflow ID")
  .argument("<run_id>", "Run ID to cancel")
  .description("Cancel an in-progress workflow run")
  .option(
    "--dry-run",
    "Verify the workflow exists and emit the plan as JSON without cancelling",
  )
  .action(async (workflowId: string, runId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      if (isDryRun(cmd)) {
        await client.workflows.get(workflowId);
        emitDryRunPlan({
          action: "workflows.cancel",
          target: workflowId,
          payload: { run_id: runId },
        });
        return;
      }
      await client.workflows.cancel(workflowId, runId);
      writeSuccess(`Cancelled run ${runId} for workflow ${workflowId}`);
    } catch (err) {
      handleError(err, {
        resource: "Workflow",
        identifier: workflowId,
        listCommand: "ixora workflows list",
        ...urlContext(cmd),
      });
    }
  });
