import type { AgentStream } from "@worksofadam/agentos-sdk";
import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getJsonFields,
  getOutputFormat,
  outputDetail,
  outputList,
  printJson,
  selectFields,
  writeSuccess,
} from "../lib/agentos-output.js";
import { handleNonStreamRun, handleStreamRun } from "../lib/agentos-stream.js";

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
      handleError(err, { resource: "Workflow", url: getBaseUrl(cmd) });
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
  .action(async (workflowId: string, message: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      if (options.stream) {
        const stream = await client.workflows.runStream(workflowId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        await handleStreamRun(cmd, stream, "workflow", {
          resourceId: workflowId,
        });
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
    } catch (err) {
      handleError(err, { resource: "Workflow", url: getBaseUrl(cmd) });
    }
  });

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
          const format = getOutputFormat(cmd);
          if (format === "json") {
            const fields = getJsonFields(cmd);
            printJson(
              fields
                ? selectFields(result as Record<string, unknown>, fields)
                : result,
            );
          } else {
            const content = (result as Record<string, unknown>).content;
            if (content) {
              process.stdout.write(
                `${typeof content === "string" ? content : JSON.stringify(content, null, 2)}\n`,
              );
            }
          }
        }
      } catch (err) {
        handleError(err, { resource: "Workflow", url: getBaseUrl(cmd) });
      }
    },
  );

workflowsCommand
  .command("cancel")
  .argument("<workflow_id>", "Workflow ID")
  .argument("<run_id>", "Run ID to cancel")
  .description("Cancel an in-progress workflow run")
  .action(async (workflowId: string, runId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.workflows.cancel(workflowId, runId);
      writeSuccess(`Cancelled run ${runId} for workflow ${workflowId}`);
    } catch (err) {
      handleError(err, { resource: "Workflow", url: getBaseUrl(cmd) });
    }
  });
