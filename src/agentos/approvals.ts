import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  printJson,
  writeError,
  writeSuccess,
} from "../lib/agentos-output.js";

export const approvalsCommand = new Command("approvals").description(
  "Manage approvals",
);

approvalsCommand
  .command("list")
  .description("List approvals")
  .option(
    "--status <status>",
    "Filter by status (e.g., pending, approved, rejected)",
  )
  .option("--agent-id <id>", "Filter by agent ID")
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
      const result = await client.approvals.list({
        status: opts.status,
        agentId: opts.agentId,
        limit: opts.limit,
        page: opts.page,
      });

      const r = result as unknown as Record<string, unknown>;
      const data = (r.data as Record<string, unknown>[]) ?? [];
      const meta = r.meta as
        | {
            page: number;
            limit: number;
            total_pages: number;
            total_count: number;
          }
        | undefined;

      outputList(
        cmd,
        data.map((a) => ({
          id: a.id ?? "",
          status: a.status ?? "",
          type: a.type ?? "",
          created_at: a.created_at ?? "",
        })),
        {
          columns: ["ID", "STATUS", "TYPE", "CREATED_AT"],
          keys: ["id", "status", "type", "created_at"],
          meta,
        },
      );
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

approvalsCommand
  .command("get")
  .argument("<id>", "Approval ID")
  .description("Get approval details")
  .action(async (id: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const result = await client.approvals.get(id);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, result as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const a = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: a.id ?? "",
          status: a.status ?? "",
          type: a.type ?? "",
          agent_id: a.agent_id ?? "",
          details: a.details ? JSON.stringify(a.details) : "",
          created_at: a.created_at ?? "",
        },
        {
          labels: ["ID", "Status", "Type", "Agent ID", "Details", "Created"],
          keys: ["id", "status", "type", "agent_id", "details", "created_at"],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Approval", url: getBaseUrl(cmd) });
    }
  });

approvalsCommand
  .command("resolve")
  .argument("<id>", "Approval ID")
  .description("Resolve an approval")
  .requiredOption(
    "--status <status>",
    "Resolution status, e.g. approved, rejected (required)",
  )
  .option("--resolved-by <user>", "Who resolved the approval")
  .option("--resolution-data <json>", "Additional resolution data as JSON")
  .action(async (id: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let resolutionData: Record<string, unknown> | undefined;
      if (opts.resolutionData) {
        try {
          resolutionData = JSON.parse(opts.resolutionData);
        } catch {
          writeError("Invalid JSON for --resolution-data");
          process.exitCode = 1;
          return;
        }
      }

      const result = await client.approvals.resolve(id, {
        status: opts.status,
        resolvedBy: opts.resolvedBy,
        resolutionData,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const a = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: a.id ?? "",
          status: a.status ?? "",
          resolved_by: a.resolved_by ?? "",
          resolved_at: a.resolved_at ?? "",
        },
        {
          labels: ["ID", "Status", "Resolved By", "Resolved At"],
          keys: ["id", "status", "resolved_by", "resolved_at"],
        },
      );
      writeSuccess("Approval resolved.");
    } catch (err) {
      handleError(err, { resource: "Approval", url: getBaseUrl(cmd) });
    }
  });
