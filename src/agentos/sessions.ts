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

export const sessionsCommand = new Command("sessions").description(
  "Manage sessions",
);

sessionsCommand
  .command("list")
  .description("List sessions")
  .option("--type <type>", "Filter by type (agent, team, workflow)")
  .option("--component-id <id>", "Filter by component ID")
  .option("--user-id <id>", "Filter by user ID")
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
      const result = await client.sessions.list({
        type: opts.type,
        componentId: opts.componentId,
        userId: opts.userId,
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

      outputList(cmd, data, {
        columns: ["SESSION_ID", "NAME", "TYPE", "CREATED_AT"],
        keys: ["session_id", "session_name", "type", "created_at"],
        meta,
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

sessionsCommand
  .command("get")
  .argument("<session_id>", "Session ID")
  .description("Get session details")
  .option("--db-id <id>", "Database ID")
  .action(async (sessionId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const session = await client.sessions.get(sessionId, {
        dbId: opts.dbId,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, session as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const s = session as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          session_id: s.session_id ?? "",
          name: s.session_name ?? "",
          type: s.type ?? "",
          state: s.session_state ? JSON.stringify(s.session_state) : "",
          created_at: s.created_at ?? "",
          updated_at: s.updated_at ?? "",
        },
        {
          labels: [
            "Session ID",
            "Name",
            "Type",
            "State",
            "Created At",
            "Updated At",
          ],
          keys: [
            "session_id",
            "name",
            "type",
            "state",
            "created_at",
            "updated_at",
          ],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Session", url: getBaseUrl(cmd) });
    }
  });

sessionsCommand
  .command("create")
  .description("Create a new session")
  .requiredOption(
    "--type <type>",
    "Session type: agent, team, workflow (required)",
  )
  .requiredOption("--component-id <id>", "Component ID (required)")
  .option("--name <name>", "Session name")
  .option("--user-id <id>", "User ID")
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const session = await client.sessions.create({
        type: opts.type,
        componentId: opts.componentId,
        name: opts.name,
        userId: opts.userId,
        dbId: opts.dbId,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(session);
        return;
      }

      const s = session as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          session_id: s.session_id ?? "",
          name: s.session_name ?? "",
          type: s.type ?? "",
          created_at: s.created_at ?? "",
        },
        {
          labels: ["Session ID", "Name", "Type", "Created At"],
          keys: ["session_id", "name", "type", "created_at"],
        },
      );
      writeSuccess("Session created.");
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

sessionsCommand
  .command("update")
  .argument("<session_id>", "Session ID")
  .description("Update a session")
  .option("--name <name>", "New session name")
  .option("--state <json>", "Session state as JSON string")
  .option("--metadata <json>", "Metadata as JSON string")
  .option("--summary <text>", "Session summary")
  .option("--db-id <id>", "Database ID")
  .action(async (sessionId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();

      let parsedState: Record<string, unknown> | undefined;
      if (opts.state) {
        try {
          parsedState = JSON.parse(opts.state as string);
        } catch {
          writeError("Invalid JSON for --state");
          process.exitCode = 1;
          return;
        }
      }

      let parsedMetadata: Record<string, unknown> | undefined;
      if (opts.metadata) {
        try {
          parsedMetadata = JSON.parse(opts.metadata as string);
        } catch {
          writeError("Invalid JSON for --metadata");
          process.exitCode = 1;
          return;
        }
      }

      const client = getClient(cmd);
      await client.sessions.update(sessionId, {
        sessionName: opts.name,
        sessionState: parsedState,
        metadata: parsedMetadata,
        summary: opts.summary,
        dbId: opts.dbId,
      });

      writeSuccess("Session updated.");
    } catch (err) {
      handleError(err, { resource: "Session", url: getBaseUrl(cmd) });
    }
  });

sessionsCommand
  .command("delete")
  .argument("<session_id>", "Session ID")
  .description("Delete a session")
  .option("--db-id <id>", "Database ID")
  .action(async (sessionId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      await client.sessions.delete(sessionId, { dbId: opts.dbId });
      writeSuccess("Session deleted.");
    } catch (err) {
      handleError(err, { resource: "Session", url: getBaseUrl(cmd) });
    }
  });

sessionsCommand
  .command("delete-all")
  .description("Delete multiple sessions")
  .requiredOption("--ids <ids>", "Comma-separated session IDs (required)")
  .requiredOption(
    "--types <types>",
    "Comma-separated session types, must match IDs (required)",
  )
  .option("--user-id <id>", "User ID")
  .option("--db-id <id>", "Database ID")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const sessionIds = (opts.ids as string)
        .split(",")
        .map((s: string) => s.trim());
      const sessionTypes = (opts.types as string)
        .split(",")
        .map((s: string) => s.trim());

      const client = getClient(cmd);
      await client.sessions.deleteAll({
        sessionIds,
        sessionTypes,
        userId: opts.userId,
        dbId: opts.dbId,
      });
      writeSuccess("Sessions deleted.");
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

sessionsCommand
  .command("runs")
  .argument("<session_id>", "Session ID")
  .description("List runs for a session")
  .option("--db-id <id>", "Database ID")
  .action(async (sessionId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const runs = await client.sessions.getRuns(sessionId, {
        dbId: opts.dbId,
      });

      outputList(cmd, runs as unknown as Record<string, unknown>[], {
        columns: ["RUN_ID", "STATUS", "CREATED_AT"],
        keys: ["run_id", "status", "created_at"],
      });
    } catch (err) {
      handleError(err, { resource: "Session", url: getBaseUrl(cmd) });
    }
  });
