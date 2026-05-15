import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import { outputList } from "../lib/agentos-output.js";

export const modelsCommand = new Command("models").description(
  "List available models",
);

modelsCommand
  .command("list")
  .description("List all available models")
  .option(
    "--limit <n>",
    "Results per page",
    (v: string) => Number.parseInt(v, 10),
    20,
  )
  .option(
    "--page <n>",
    "Page number",
    (v: string) => Number.parseInt(v, 10),
    1,
  )
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const models = await client.models.list();

      const limit = opts.limit as number;
      const page = opts.page as number;
      const start = (page - 1) * limit;
      const paged = models.slice(start, start + limit);
      const meta = {
        page,
        limit,
        total_pages: Math.ceil(models.length / limit),
        total_count: models.length,
      };

      outputList(
        cmd,
        paged.map((m) => ({
          id: m.id ?? "",
          provider: m.provider ?? "",
        })),
        {
          columns: ["ID", "PROVIDER"],
          keys: ["id", "provider"],
          meta,
        },
      );
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });
