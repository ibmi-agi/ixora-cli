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

export const schedulesCommand = new Command("schedules").description(
  "Manage schedules",
);

schedulesCommand
  .command("list")
  .description("List schedules")
  .option("--enabled", "Filter to enabled schedules only")
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
      const result = await client.schedules.list({
        enabled: opts.enabled,
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
        data.map((s) => ({
          id: s.id ?? "",
          name: s.name ?? "",
          cron: s.cron_expr ?? "",
          enabled: s.enabled ?? "",
          next_run: s.next_run ?? "",
        })),
        {
          columns: ["ID", "NAME", "CRON", "ENABLED", "NEXT_RUN"],
          keys: ["id", "name", "cron", "enabled", "next_run"],
          meta,
        },
      );
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("get")
  .argument("<id>", "Schedule ID")
  .description("Get schedule details")
  .action(async (id: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const result = await client.schedules.get(id);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, result as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const s = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: s.id ?? "",
          name: s.name ?? "",
          cron_expr: s.cron_expr ?? "",
          endpoint: s.endpoint ?? "",
          method: s.method ?? "",
          enabled: s.enabled ?? "",
          timezone: s.timezone ?? "",
          next_run: s.next_run ?? "",
          created_at: s.created_at ?? "",
        },
        {
          labels: [
            "ID",
            "Name",
            "Cron",
            "Endpoint",
            "Method",
            "Enabled",
            "Timezone",
            "Next Run",
            "Created",
          ],
          keys: [
            "id",
            "name",
            "cron_expr",
            "endpoint",
            "method",
            "enabled",
            "timezone",
            "next_run",
            "created_at",
          ],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Schedule", url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("create")
  .description("Create a schedule")
  .requiredOption("--name <name>", "Schedule name (required)")
  .requiredOption("--cron <expr>", "Cron expression (required)")
  .requiredOption("--endpoint <url>", "Endpoint URL (required)")
  .requiredOption(
    "--method <method>",
    "HTTP method: GET, POST, etc. (required)",
  )
  .option("--description <desc>", "Schedule description")
  .option("--payload <json>", "Request payload as JSON")
  .option("--timezone <tz>", "Timezone (default: UTC)")
  .option("--timeout-seconds <n>", "Timeout in seconds", (v: string) =>
    Number.parseInt(v, 10),
  )
  .option("--max-retries <n>", "Maximum retries", (v: string) =>
    Number.parseInt(v, 10),
  )
  .option("--retry-delay-seconds <n>", "Retry delay in seconds", (v: string) =>
    Number.parseInt(v, 10),
  )
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let payload: Record<string, unknown> | undefined;
      if (opts.payload) {
        try {
          payload = JSON.parse(opts.payload);
        } catch {
          writeError("Invalid JSON for --payload");
          process.exitCode = 1;
          return;
        }
      }

      const result = await client.schedules.create({
        name: opts.name,
        cronExpr: opts.cron,
        endpoint: opts.endpoint,
        method: opts.method,
        description: opts.description,
        payload,
        timezone: opts.timezone,
        timeoutSeconds: opts.timeoutSeconds,
        maxRetries: opts.maxRetries,
        retryDelaySeconds: opts.retryDelaySeconds,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const s = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: s.id ?? "",
          name: s.name ?? "",
          cron_expr: s.cron_expr ?? "",
          enabled: s.enabled ?? "",
        },
        {
          labels: ["ID", "Name", "Cron", "Enabled"],
          keys: ["id", "name", "cron_expr", "enabled"],
        },
      );
      writeSuccess("Schedule created.");
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("update")
  .argument("<id>", "Schedule ID")
  .description("Update a schedule")
  .option("--name <name>", "Schedule name")
  .option("--cron <expr>", "Cron expression")
  .option("--endpoint <url>", "Endpoint URL")
  .option("--method <method>", "HTTP method")
  .option("--description <desc>", "Schedule description")
  .option("--payload <json>", "Request payload as JSON")
  .option("--timezone <tz>", "Timezone")
  .option("--timeout-seconds <n>", "Timeout in seconds", (v: string) =>
    Number.parseInt(v, 10),
  )
  .option("--max-retries <n>", "Maximum retries", (v: string) =>
    Number.parseInt(v, 10),
  )
  .option("--retry-delay-seconds <n>", "Retry delay in seconds", (v: string) =>
    Number.parseInt(v, 10),
  )
  .action(async (id: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let payload: Record<string, unknown> | undefined;
      if (opts.payload) {
        try {
          payload = JSON.parse(opts.payload);
        } catch {
          writeError("Invalid JSON for --payload");
          process.exitCode = 1;
          return;
        }
      }

      const updateOpts: Record<string, unknown> = {};
      if (opts.name) updateOpts.name = opts.name;
      if (opts.cron) updateOpts.cronExpr = opts.cron;
      if (opts.endpoint) updateOpts.endpoint = opts.endpoint;
      if (opts.method) updateOpts.method = opts.method;
      if (opts.description) updateOpts.description = opts.description;
      if (payload) updateOpts.payload = payload;
      if (opts.timezone) updateOpts.timezone = opts.timezone;
      if (opts.timeoutSeconds) updateOpts.timeoutSeconds = opts.timeoutSeconds;
      if (opts.maxRetries) updateOpts.maxRetries = opts.maxRetries;
      if (opts.retryDelaySeconds)
        updateOpts.retryDelaySeconds = opts.retryDelaySeconds;

      const result = await client.schedules.update(id, updateOpts);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const s = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: s.id ?? "",
          name: s.name ?? "",
          cron_expr: s.cron_expr ?? "",
          enabled: s.enabled ?? "",
        },
        {
          labels: ["ID", "Name", "Cron", "Enabled"],
          keys: ["id", "name", "cron_expr", "enabled"],
        },
      );
      writeSuccess("Schedule updated.");
    } catch (err) {
      handleError(err, { resource: "Schedule", url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("delete")
  .argument("<id>", "Schedule ID")
  .description("Delete a schedule")
  .action(async (id: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.schedules.delete(id);
      writeSuccess(`Schedule ${id} deleted.`);
    } catch (err) {
      handleError(err, { resource: "Schedule", url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("pause")
  .argument("<id>", "Schedule ID")
  .description("Pause a schedule")
  .action(async (id: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.schedules.disable(id);
      writeSuccess("Schedule paused.");
    } catch (err) {
      handleError(err, { resource: "Schedule", url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("resume")
  .argument("<id>", "Schedule ID")
  .description("Resume a schedule")
  .action(async (id: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.schedules.enable(id);
      writeSuccess("Schedule resumed.");
    } catch (err) {
      handleError(err, { resource: "Schedule", url: getBaseUrl(cmd) });
    }
  });

schedulesCommand
  .command("runs")
  .argument("<id>", "Schedule ID")
  .description("List schedule run history")
  .action(async (id: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const result = await client.schedules.listRuns(id);

      const r = result as unknown as Record<string, unknown>;
      const data =
        (r.data as Record<string, unknown>[]) ??
        ((Array.isArray(result) ? result : []) as Record<string, unknown>[]);
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
        (data as Record<string, unknown>[]).map((run) => ({
          id: run.id ?? "",
          status: run.status ?? "",
          started_at: run.started_at ?? "",
          completed_at: run.completed_at ?? "",
        })),
        {
          columns: ["ID", "STATUS", "STARTED_AT", "COMPLETED_AT"],
          keys: ["id", "status", "started_at", "completed_at"],
          meta,
        },
      );
    } catch (err) {
      handleError(err, { resource: "Schedule", url: getBaseUrl(cmd) });
    }
  });
