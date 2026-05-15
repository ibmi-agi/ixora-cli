import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import { writeSuccess } from "../lib/agentos-output.js";

export const databasesCommand = new Command("databases").description(
  "Manage databases",
);

databasesCommand
  .command("migrate")
  .argument("<db_id>", "Database ID")
  .description("Run database migrations")
  .option("--target-version <version>", "Target migration version")
  .action(async (dbId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      await client.database.migrate(dbId, {
        targetVersion: opts.targetVersion,
      });

      writeSuccess("Database migration complete.");
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });
