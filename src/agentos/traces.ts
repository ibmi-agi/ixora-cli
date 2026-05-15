import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  printJson,
  writeError,
} from "../lib/agentos-output.js";

export const tracesCommand = new Command("traces").description(
  "Manage traces",
);

tracesCommand
  .command("list")
  .description("List traces")
  .option("--run-id <id>", "Filter by run ID")
  .option("--session-id <id>", "Filter by session ID")
  .option("--user-id <id>", "Filter by user ID")
  .option("--agent-id <id>", "Filter by agent ID")
  .option("--status <status>", "Filter by status")
  .option(
    "--limit <n>",
    "Results per page",
    (v: string) => Number.parseInt(v, 10),
    20,
  )
  .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10), 1)
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const result = await client.traces.list({
        runId: opts.runId,
        sessionId: opts.sessionId,
        userId: opts.userId,
        agentId: opts.agentId,
        status: opts.status,
        page: opts.page,
        limit: opts.limit,
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

      outputList(cmd, data, {
        columns: ["TRACE_ID", "NAME", "STATUS", "DURATION", "START_TIME"],
        keys: ["trace_id", "name", "status", "duration", "start_time"],
        meta,
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

tracesCommand
  .command("get")
  .argument("<trace_id>", "Trace ID")
  .description("Get trace details")
  .option("--db-id <id>", "Database ID")
  .action(async (traceId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const result = await client.traces.get(traceId, { dbId: opts.dbId });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, result as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const t = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          trace_id: t.trace_id ?? "",
          name: t.name ?? "",
          status: t.status ?? "",
          duration: t.duration ?? "",
          start_time: t.start_time ?? "",
          end_time: t.end_time ?? "",
          error: t.error ?? "",
        },
        {
          labels: [
            "Trace ID",
            "Name",
            "Status",
            "Duration",
            "Start Time",
            "End Time",
            "Error",
          ],
          keys: [
            "trace_id",
            "name",
            "status",
            "duration",
            "start_time",
            "end_time",
            "error",
          ],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Trace", url: getBaseUrl(cmd) });
    }
  });

tracesCommand
  .command("stats")
  .description("Get trace statistics")
  .option("--user-id <id>", "Filter by user ID")
  .option("--agent-id <id>", "Filter by agent ID")
  .option("--team-id <id>", "Filter by team ID")
  .option("--workflow-id <id>", "Filter by workflow ID")
  .option("--start-time <time>", "Start time filter")
  .option("--end-time <time>", "End time filter")
  .option("--limit <n>", "Results per page", (v: string) =>
    Number.parseInt(v, 10),
  )
  .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10))
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const result = await client.traces.getStats({
        userId: opts.userId,
        agentId: opts.agentId,
        teamId: opts.teamId,
        workflowId: opts.workflowId,
        startTime: opts.startTime,
        endTime: opts.endTime,
        page: opts.page,
        limit: opts.limit,
        dbId: opts.dbId,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const r = result as Record<string, unknown>;
      if (Array.isArray(r.data)) {
        const data = r.data as Record<string, unknown>[];
        outputList(
          cmd,
          data.map((s) => ({
            session_id: (s as Record<string, unknown>).session_id ?? "",
            user_id: (s as Record<string, unknown>).user_id ?? "",
            agent_id: (s as Record<string, unknown>).agent_id ?? "",
            total_traces:
              (s as Record<string, unknown>).total_traces ?? 0,
            first_trace_at:
              (s as Record<string, unknown>).first_trace_at ?? "",
            last_trace_at:
              (s as Record<string, unknown>).last_trace_at ?? "",
          })),
          {
            columns: [
              "SESSION_ID",
              "USER_ID",
              "AGENT_ID",
              "TOTAL_TRACES",
              "FIRST_TRACE",
              "LAST_TRACE",
            ],
            keys: [
              "session_id",
              "user_id",
              "agent_id",
              "total_traces",
              "first_trace_at",
              "last_trace_at",
            ],
          },
        );
      } else {
        printJson(result);
      }
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

tracesCommand
  .command("search")
  .description("Search traces")
  .option("--filter <json>", "Filter as JSON string")
  .option("--group-by <field>", "Group results by: run, session")
  .option(
    "--limit <n>",
    "Results per page",
    (v: string) => Number.parseInt(v, 10),
    20,
  )
  .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10), 1)
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();

      let parsedFilter: Record<string, unknown> | undefined;
      if (opts.filter) {
        try {
          parsedFilter = JSON.parse(opts.filter as string);
        } catch {
          writeError("Invalid JSON for --filter");
          process.exitCode = 1;
          return;
        }
      }

      const client = getClient(cmd);
      const result = await client.traces.search({
        filter: parsedFilter,
        groupBy: opts.groupBy,
        page: opts.page,
        limit: opts.limit,
        dbId: opts.dbId,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const r = result as Record<string, unknown>;
      if (Array.isArray(r.data)) {
        const data = r.data as Record<string, unknown>[];
        outputList(
          cmd,
          data.map((t) => ({
            trace_id: (t as Record<string, unknown>).trace_id ?? "",
            name: (t as Record<string, unknown>).name ?? "",
            status: (t as Record<string, unknown>).status ?? "",
            duration: (t as Record<string, unknown>).duration ?? "",
          })),
          {
            columns: ["TRACE_ID", "NAME", "STATUS", "DURATION"],
            keys: ["trace_id", "name", "status", "duration"],
          },
        );
      } else {
        printJson(result);
      }
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });
