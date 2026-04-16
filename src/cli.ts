import { Command } from "commander";
import { SCRIPT_VERSION } from "./lib/constants.js";
import { cmdVersion } from "./commands/version.js";
import { cmdStatus } from "./commands/status.js";
import { cmdStart } from "./commands/start.js";
import { cmdStop } from "./commands/stop.js";
import { cmdRestart } from "./commands/restart.js";
import { cmdLogs } from "./commands/logs.js";
import { cmdUpgrade } from "./commands/upgrade.js";
import { cmdUninstall } from "./commands/uninstall.js";
import { cmdInstall } from "./commands/install.js";
import {
  cmdConfigShow,
  cmdConfigSet,
  cmdConfigEdit,
} from "./commands/config.js";
import {
  cmdSystemAdd,
  cmdSystemRemove,
  cmdSystemList,
  cmdSystemStart,
  cmdSystemStop,
  cmdSystemRestart,
} from "./commands/system.js";
import { cmdModelsShow, cmdModelsSet } from "./commands/models.js";

export function createProgram(): Command {
  const program = new Command()
    .name("ixora")
    .description("Manage ixora AI agent deployments on IBM i")
    .version(SCRIPT_VERSION, "-V, --cli-version", "Show CLI version number")
    .option(
      "--profile <name>",
      "Agent profile (full|sql-services|security|knowledge)",
    )
    .option("--image-version <tag>", "Pin image version (e.g., v1.2.0)")
    .option("--no-pull", "Skip pulling images")
    .option("--purge", "Remove volumes too (with uninstall)")
    .option("--runtime <name>", "Force container runtime (docker or podman)");

  program
    .command("install")
    .description("First-time setup (interactive)")
    .action(async () => {
      const opts = program.opts();
      await cmdInstall(opts);
    });

  program
    .command("start")
    .argument("[service]", "Service to start (omit for all)")
    .description("Start all services, or a specific service by name")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdStart(opts, service);
    });

  program
    .command("stop")
    .argument("[service]", "Service to stop (omit for all)")
    .description("Stop all services, or a specific service by name")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdStop(opts, service);
    });

  program
    .command("restart")
    .argument("[service]", "Service to restart (omit for all)")
    .description("Restart all services, or a specific service by name")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdRestart(opts, service);
    });

  program
    .command("status")
    .description("Show service status and deployed profile")
    .action(async () => {
      const opts = program.opts();
      await cmdStatus(opts);
    });

  program
    .command("upgrade")
    .description("Pull latest images and restart")
    .argument("[version]", "Target version (e.g., 0.0.11 or v0.0.11)")
    .action(async (version?: string) => {
      const opts = program.opts();
      await cmdUpgrade({ ...opts, version });
    });

  program
    .command("uninstall")
    .description("Stop services and remove images")
    .action(async () => {
      const opts = program.opts();
      await cmdUninstall(opts);
    });

  program
    .command("logs")
    .argument("[service]", "Service to show logs for (omit for all)")
    .description("Tail service logs")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdLogs(opts, service);
    });

  program
    .command("version")
    .description("Show CLI and image versions")
    .action(async () => {
      const opts = program.opts();
      await cmdVersion(opts);
    });

  // Config subcommands
  const configCmd = program
    .command("config")
    .description("View and edit deployment configuration");

  configCmd
    .command("show", { isDefault: true })
    .description("Show current configuration")
    .action(() => {
      cmdConfigShow();
    });

  configCmd
    .command("set")
    .argument("<key>", "Configuration key")
    .argument("<value>", "Configuration value")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      cmdConfigSet(key, value);
    });

  configCmd
    .command("edit")
    .description("Open configuration in your editor")
    .action(async () => {
      await cmdConfigEdit();
    });

  // System subcommands
  const systemCmd = program
    .command("system")
    .description("Manage IBM i systems (add, remove, list)");

  systemCmd
    .command("add")
    .description("Add an IBM i system")
    .action(async () => {
      await cmdSystemAdd();
    });

  systemCmd
    .command("remove")
    .argument("<id>", "System ID to remove")
    .description("Remove a system by ID")
    .action((id: string) => {
      cmdSystemRemove(id);
    });

  systemCmd
    .command("list", { isDefault: true })
    .description("List configured systems")
    .action(() => {
      cmdSystemList();
    });

  systemCmd
    .command("start")
    .argument("<id>", "System ID (from ixora system)")
    .description("Start a specific system's services")
    .action(async (id: string) => {
      await cmdSystemStart(id);
    });

  systemCmd
    .command("stop")
    .argument("<id>", "System ID (from ixora system)")
    .description("Stop a specific system's services")
    .action(async (id: string) => {
      await cmdSystemStop(id);
    });

  systemCmd
    .command("restart")
    .argument("<id>", "System ID (from ixora system)")
    .description("Restart a specific system's services")
    .action(async (id: string) => {
      await cmdSystemRestart(id);
    });

  // Models subcommands
  const modelsCmd = program
    .command("models")
    .description("View and switch AI model configuration");

  modelsCmd
    .command("show", { isDefault: true })
    .description("Show current model and provider")
    .action(() => {
      cmdModelsShow();
    });

  modelsCmd
    .command("set")
    .argument(
      "[provider]",
      "Provider name (anthropic, openai, google, ollama, openai-compatible, custom)",
    )
    .description("Switch model provider")
    .action(async (provider?: string) => {
      await cmdModelsSet(provider);
    });

  return program;
}
