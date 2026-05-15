import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  writeSuccess,
} from "../lib/agentos-output.js";

export const evalsCommand = new Command("evals").description(
  "Manage eval runs",
);

evalsCommand
  .command("list")
  .description("List eval runs")
  .option("--agent-id <id>", "Filter by agent ID")
  .option("--team-id <id>", "Filter by team ID")
  .option("--workflow-id <id>", "Filter by workflow ID")
  .option("--model-id <id>", "Filter by model ID")
  .option("--type <type>", "Filter by eval type")
  .option(
    "--limit <n>",
    "Results per page",
    (v: string) => Number.parseInt(v, 10),
    20,
  )
  .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10), 1)
  .option("--sort-by <field>", "Sort field")
  .option("--sort-order <order>", "Sort order (asc, desc)")
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const result = await client.evals.list({
        agentId: opts.agentId,
        teamId: opts.teamId,
        workflowId: opts.workflowId,
        modelId: opts.modelId,
        type: opts.type,
        page: opts.page,
        limit: opts.limit,
        sortBy: opts.sortBy,
        sortOrder: opts.sortOrder,
        dbId: opts.dbId,
      });

      const data = (result as Record<string, unknown>).data as Record<
        string,
        unknown
      >[];
      const meta = (result as Record<string, unknown>).meta as
        | {
            page: number;
            limit: number;
            total_pages: number;
            total_count: number;
          }
        | undefined;

      outputList(
        cmd,
        data.map((e) => ({
          id: (e as Record<string, unknown>).id ?? "",
          name: (e as Record<string, unknown>).name ?? "",
          eval_type: (e as Record<string, unknown>).eval_type ?? "",
          agent_id: (e as Record<string, unknown>).agent_id ?? "",
          created_at: (e as Record<string, unknown>).created_at ?? "",
        })),
        {
          columns: ["ID", "NAME", "EVAL_TYPE", "AGENT_ID", "CREATED_AT"],
          keys: ["id", "name", "eval_type", "agent_id", "created_at"],
          meta,
        },
      );
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

evalsCommand
  .command("get")
  .argument("<eval_run_id>", "Eval run ID")
  .description("Get eval run details")
  .option("--db-id <id>", "Database ID")
  .action(async (evalRunId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const result = await client.evals.get(evalRunId, { dbId: opts.dbId });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, result as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const e = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: e.id ?? "",
          name: e.name ?? "",
          eval_type: e.eval_type ?? "",
          agent_id: e.agent_id ?? "",
          input: e.input ?? "",
          output: e.output ?? "",
          expected_output: e.expected_output ?? "",
          score: e.score ?? "",
          created_at: e.created_at ?? "",
        },
        {
          labels: [
            "ID",
            "Name",
            "Eval Type",
            "Agent ID",
            "Input",
            "Output",
            "Expected Output",
            "Score",
            "Created At",
          ],
          keys: [
            "id",
            "name",
            "eval_type",
            "agent_id",
            "input",
            "output",
            "expected_output",
            "score",
            "created_at",
          ],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Eval", url: getBaseUrl(cmd) });
    }
  });

evalsCommand
  .command("delete")
  .description("Delete eval runs")
  .requiredOption(
    "--ids <ids>",
    "Comma-separated eval run IDs to delete (required)",
  )
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const parsedIds = (opts.ids as string)
        .split(",")
        .map((id: string) => id.trim());

      const client = getClient(cmd);
      await client.evals.delete({ ids: parsedIds, dbId: opts.dbId });
      writeSuccess("Eval runs deleted.");
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });
