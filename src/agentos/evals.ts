import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  writeSuccess,
} from "../lib/agentos-output.js";

const EVAL_TYPES = [
  "accuracy",
  "agent_as_judge",
  "performance",
  "reliability",
] as const;
type EvalType = (typeof EVAL_TYPES)[number];

const SCORING_STRATEGIES = ["numeric", "binary"] as const;

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
  .command("run")
  .description(
    "Create and run an eval synchronously (may take 30+s for LLM-judge evals)",
  )
  .option("--agent-id <id>", "Agent to evaluate (mutex with --team-id)")
  .option("--team-id <id>", "Team to evaluate (mutex with --agent-id)")
  .requiredOption(
    "--eval-type <type>",
    `One of: ${EVAL_TYPES.join("|")}`,
  )
  .requiredOption("--input <text>", "Input prompt for the evaluation")
  .option(
    "--expected-output <text>",
    "Required for --eval-type accuracy",
  )
  .option(
    "--criteria <text>",
    "Required for --eval-type agent_as_judge",
  )
  .option(
    "--expected-tool-calls <csv>",
    "Required for --eval-type reliability (comma-separated tool names)",
  )
  .option("--model-id <id>", "Model ID to use for evaluation")
  .option("--model-provider <name>", "Model provider name")
  .option(
    "--scoring-strategy <s>",
    `Scoring strategy: ${SCORING_STRATEGIES.join("|")} (default: binary)`,
  )
  .option(
    "--threshold <n>",
    "Score threshold (1-10), only with numeric scoring",
    (v: string) => Number.parseFloat(v),
  )
  .option(
    "--warmup-runs <n>",
    "Number of warmup runs before measuring",
    (v: string) => Number.parseInt(v, 10),
  )
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();

      const hasAgent = Boolean(opts.agentId);
      const hasTeam = Boolean(opts.teamId);
      if (hasAgent === hasTeam) {
        cmd.error(
          "Exactly one of --agent-id or --team-id is required",
        );
      }

      const evalType = opts.evalType as string;
      if (!(EVAL_TYPES as readonly string[]).includes(evalType)) {
        cmd.error(
          `--eval-type must be one of: ${EVAL_TYPES.join(", ")}`,
        );
      }

      if (
        opts.scoringStrategy &&
        !(SCORING_STRATEGIES as readonly string[]).includes(
          opts.scoringStrategy as string,
        )
      ) {
        cmd.error(
          `--scoring-strategy must be one of: ${SCORING_STRATEGIES.join(", ")}`,
        );
      }

      if (evalType === "accuracy" && !opts.expectedOutput) {
        cmd.error("--expected-output is required for --eval-type accuracy");
      }
      if (evalType === "agent_as_judge" && !opts.criteria) {
        cmd.error("--criteria is required for --eval-type agent_as_judge");
      }
      if (evalType === "reliability" && !opts.expectedToolCalls) {
        cmd.error(
          "--expected-tool-calls is required for --eval-type reliability",
        );
      }

      const expectedToolCalls = opts.expectedToolCalls
        ? String(opts.expectedToolCalls)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      // NOTE: We bypass `client.evals.create()` because the SDK
      // (v0.6.0) double-stringifies the body — it calls
      // `JSON.stringify(body)` inside the resource method, then the
      // shared transport stringifies again, so the server receives a
      // JSON string instead of an object and rejects with 422.
      // Calling `client.request()` with a raw object stringifies once.
      const body: Record<string, unknown> = {
        eval_type: evalType,
        input: opts.input,
      };
      if (opts.agentId) body.agent_id = opts.agentId;
      if (opts.teamId) body.team_id = opts.teamId;
      if (opts.modelId) body.model_id = opts.modelId;
      if (opts.modelProvider) body.model_provider = opts.modelProvider;
      if (opts.expectedOutput) body.expected_output = opts.expectedOutput;
      if (opts.criteria) body.criteria = opts.criteria;
      if (expectedToolCalls) body.expected_tool_calls = expectedToolCalls;
      if (opts.scoringStrategy) body.scoring_strategy = opts.scoringStrategy;
      if (opts.threshold !== undefined) body.threshold = opts.threshold;
      if (opts.warmupRuns !== undefined) body.warmup_runs = opts.warmupRuns;

      const params = new URLSearchParams();
      if (opts.dbId) params.append("db_id", String(opts.dbId));
      const qs = params.toString();
      const path = qs ? `/eval-runs?${qs}` : "/eval-runs";

      const client = getClient(cmd);
      const result = await client.request<unknown>("POST", path, {
        body: body as unknown as BodyInit,
        headers: { "Content-Type": "application/json" },
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, result as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const e = result as Record<string, unknown>;
      const evalData = (e.eval_data ?? {}) as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: e.id ?? "",
          name: e.name ?? "",
          eval_type: e.eval_type ?? "",
          agent_id: e.agent_id ?? "",
          team_id: e.team_id ?? "",
          model_id: e.model_id ?? "",
          eval_status: evalData.eval_status ?? "",
          score: evalData.score ?? e.score ?? "",
          passed_tool_calls: evalData.passed_tool_calls ?? "",
          failed_tool_calls: evalData.failed_tool_calls ?? "",
          created_at: e.created_at ?? "",
        },
        {
          labels: [
            "ID",
            "Name",
            "Eval Type",
            "Agent ID",
            "Team ID",
            "Model ID",
            "Eval Status",
            "Score",
            "Passed Tool Calls",
            "Failed Tool Calls",
            "Created At",
          ],
          keys: [
            "id",
            "name",
            "eval_type",
            "agent_id",
            "team_id",
            "model_id",
            "eval_status",
            "score",
            "passed_tool_calls",
            "failed_tool_calls",
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
