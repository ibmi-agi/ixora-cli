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

export const componentsCommand = new Command("components").description(
  "Manage components",
);

componentsCommand
  .command("list")
  .description("List components")
  .option("--type <type>", "Filter by type (agent, team, workflow)")
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
      const result = await client.components.list({
        componentType: opts.type,
        page: opts.page,
        limit: opts.limit,
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

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson({ data, meta });
        return;
      }

      outputList(
        cmd,
        data.map((c) => ({
          id: c.id ?? "",
          name: c.name ?? "",
          type: c.component_type ?? "",
          stage: c.stage ?? "",
        })),
        {
          columns: ["ID", "NAME", "TYPE", "STAGE"],
          keys: ["id", "name", "type", "stage"],
          meta,
        },
      );
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

componentsCommand
  .command("get")
  .argument("<component_id>", "Component ID")
  .description("Get component details")
  .action(async (componentId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const result = await client.components.get(componentId);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, result as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const c = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: c.id ?? "",
          name: c.name ?? "",
          component_type: c.component_type ?? "",
          description: c.description ?? "",
          stage: c.stage ?? "",
          created_at: c.created_at ?? "",
        },
        {
          labels: ["ID", "Name", "Type", "Description", "Stage", "Created"],
          keys: [
            "id",
            "name",
            "component_type",
            "description",
            "stage",
            "created_at",
          ],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Component", url: getBaseUrl(cmd) });
    }
  });

componentsCommand
  .command("create")
  .description("Create a component")
  .requiredOption("--name <name>", "Component name (required)")
  .requiredOption(
    "--type <type>",
    "Component type: agent, team, workflow (required)",
  )
  .option("--description <desc>", "Component description")
  .option("--config <json>", "Configuration as JSON")
  .option("--stage <stage>", "Stage (draft, published)")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let config: Record<string, unknown> | undefined;
      if (opts.config) {
        try {
          config = JSON.parse(opts.config);
        } catch {
          writeError("Invalid JSON for --config");
          process.exitCode = 1;
          return;
        }
      }

      const result = await client.components.create({
        name: opts.name,
        componentType: opts.type,
        description: opts.description,
        config,
        stage: opts.stage,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const c = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: c.id ?? "",
          name: c.name ?? "",
          component_type: c.component_type ?? "",
          stage: c.stage ?? "",
        },
        {
          labels: ["ID", "Name", "Type", "Stage"],
          keys: ["id", "name", "component_type", "stage"],
        },
      );
      writeSuccess("Component created.");
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

componentsCommand
  .command("update")
  .argument("<component_id>", "Component ID")
  .description("Update a component")
  .option("--name <name>", "Component name")
  .option("--type <type>", "Component type")
  .option("--description <desc>", "Component description")
  .option("--config <json>", "Configuration as JSON")
  .option("--stage <stage>", "Stage (draft, published)")
  .action(async (componentId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let config: Record<string, unknown> | undefined;
      if (opts.config) {
        try {
          config = JSON.parse(opts.config);
        } catch {
          writeError("Invalid JSON for --config");
          process.exitCode = 1;
          return;
        }
      }

      const updateOpts: Record<string, unknown> = {};
      if (opts.name) updateOpts.name = opts.name;
      if (opts.type) updateOpts.componentType = opts.type;
      if (opts.description) updateOpts.description = opts.description;
      if (config) updateOpts.config = config;
      if (opts.stage) updateOpts.stage = opts.stage;

      const result = await client.components.update(componentId, updateOpts);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const c = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          id: c.id ?? "",
          name: c.name ?? "",
          component_type: c.component_type ?? "",
          stage: c.stage ?? "",
        },
        {
          labels: ["ID", "Name", "Type", "Stage"],
          keys: ["id", "name", "component_type", "stage"],
        },
      );
      writeSuccess("Component updated.");
    } catch (err) {
      handleError(err, { resource: "Component", url: getBaseUrl(cmd) });
    }
  });

componentsCommand
  .command("delete")
  .argument("<component_id>", "Component ID")
  .description("Delete a component")
  .action(async (componentId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.components.delete(componentId);
      writeSuccess(`Component ${componentId} deleted.`);
    } catch (err) {
      handleError(err, { resource: "Component", url: getBaseUrl(cmd) });
    }
  });

const configSubCommand = new Command("config").description(
  "Manage component configurations",
);

configSubCommand
  .command("list")
  .argument("<component_id>", "Component ID")
  .description("List component configurations")
  .action(async (componentId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const result = await client.components.listConfigs(componentId);

      const data = (Array.isArray(result) ? result : []) as Record<
        string,
        unknown
      >[];

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(data);
        return;
      }

      outputList(
        cmd,
        data.map((c) => ({
          version: c.version ?? "",
          status: c.status ?? "",
          created_at: c.created_at ?? "",
        })),
        {
          columns: ["VERSION", "STATUS", "CREATED_AT"],
          keys: ["version", "status", "created_at"],
        },
      );
    } catch (err) {
      handleError(err, { resource: "Component", url: getBaseUrl(cmd) });
    }
  });

configSubCommand
  .command("create")
  .argument("<component_id>", "Component ID")
  .description("Create a component configuration")
  .requiredOption("--config <json>", "Configuration as JSON (required)")
  .action(async (componentId: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let config: Record<string, unknown>;
      try {
        config = JSON.parse(opts.config);
      } catch {
        writeError("Invalid JSON for --config");
        process.exitCode = 1;
        return;
      }

      const result = await client.components.createConfig(componentId, {
        config,
      });

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const c = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          version: c.version ?? "",
          status: c.status ?? "",
          created_at: c.created_at ?? "",
        },
        {
          labels: ["Version", "Status", "Created"],
          keys: ["version", "status", "created_at"],
        },
      );
      writeSuccess("Configuration created.");
    } catch (err) {
      handleError(err, { resource: "Component", url: getBaseUrl(cmd) });
    }
  });

configSubCommand
  .command("update")
  .argument("<component_id>", "Component ID")
  .argument("<version>", "Configuration version number")
  .description("Update a draft component configuration")
  .requiredOption("--config <json>", "Configuration as JSON (required)")
  .action(async (componentId: string, version: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);

      let config: Record<string, unknown>;
      try {
        config = JSON.parse(opts.config);
      } catch {
        writeError("Invalid JSON for --config");
        process.exitCode = 1;
        return;
      }

      const result = await client.components.updateDraftConfig(
        componentId,
        Number.parseInt(version, 10),
        { config },
      );

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(result);
        return;
      }

      const c = result as Record<string, unknown>;
      outputDetail(
        cmd,
        {
          version: c.version ?? "",
          status: c.status ?? "",
        },
        {
          labels: ["Version", "Status"],
          keys: ["version", "status"],
        },
      );
      writeSuccess("Configuration updated.");
    } catch (err) {
      handleError(err, { resource: "Component", url: getBaseUrl(cmd) });
    }
  });

configSubCommand
  .command("delete")
  .argument("<component_id>", "Component ID")
  .argument("<version>", "Configuration version number")
  .description("Delete a component configuration version")
  .action(async (componentId: string, version: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      await client.components.deleteConfigVersion(
        componentId,
        Number.parseInt(version, 10),
      );
      writeSuccess(`Configuration version ${version} deleted.`);
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

componentsCommand.addCommand(configSubCommand);
