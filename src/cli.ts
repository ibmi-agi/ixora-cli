import { Command } from "commander";
import { agentsCommand } from "./agentos/agents.js";
import { approvalsCommand } from "./agentos/approvals.js";
import { componentsCommand as agnoComponentsCommand } from "./agentos/components.js";
import { databasesCommand } from "./agentos/databases.js";
import { evalsCommand } from "./agentos/evals.js";
import { knowledgeCommand } from "./agentos/knowledge.js";
import { memoriesCommand } from "./agentos/memories.js";
import { metricsCommand } from "./agentos/metrics.js";
import { modelsCommand as agnoModelsCommand } from "./agentos/models.js";
import { registriesCommand } from "./agentos/registries.js";
import { schedulesCommand } from "./agentos/schedules.js";
import { sessionsCommand } from "./agentos/sessions.js";
import { statusCommand as agnoStatusCommand } from "./agentos/status.js";
import { teamsCommand } from "./agentos/teams.js";
import { tracesCommand } from "./agentos/traces.js";
import { workflowsCommand } from "./agentos/workflows.js";
import { setAgentOSContext } from "./lib/agentos-context.js";
import {
  type ResolverFlags,
  resolveAgentOSTarget,
} from "./lib/agentos-resolver.js";
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
  cmdSystemConfigShow,
  cmdSystemConfigEdit,
  cmdSystemConfigReset,
} from "./commands/config.js";
import { cmdComponentsList } from "./commands/components.js";
import { cmdAgentsEdit } from "./commands/agents.js";
import {
  cmdSystemAdd,
  cmdSystemDefault,
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
      "Stack shape: full (DB + API + MCP + UI), mcp (DB + API + MCP, no UI), or cli (DB + API only, no MCP container) [default: full]",
    )
    .option(
      "--mode <name>",
      "Deployment mode for this system: full (every component) or custom (interactive picker writing ~/.ixora/profiles/<id>.yaml). Used at install time.",
    )
    .option("--image-version <tag>", "Pin image version (e.g., v1.2.0)")
    .option("--no-pull", "Skip pulling images")
    .option("--purge", "Remove volumes too (with uninstall)")
    .option("--runtime <name>", "Force container runtime (docker or podman)")
    // ── AgentOS-targeting flags (consumed by ported agno commands) ──
    .option(
      "-s, --system <name>",
      "Target a specific configured system (omit to use the only running one)",
    )
    .option(
      "--url <url>",
      "Override AgentOS endpoint entirely (skips system resolution)",
    )
    .option("--key <key>", "Override AgentOS API key for this invocation")
    .option(
      "--timeout <seconds>",
      "Override request timeout in seconds",
      (v: string) => Number.parseFloat(v),
    )
    .option("--no-color", "Disable color output")
    .option(
      "--json [fields]",
      "Emit JSON; pass a comma list (e.g. --json id,name) to project fields",
    )
    .option(
      "-o, --output <format>",
      "Output format: json or table (auto-detects from TTY)",
    );

  // The preAction hook fires before any subcommand's action. For commands
  // mounted directly under the root (the ported agno tree), we resolve the
  // AgentOS target from --system / .env / running-container state and stash
  // it on the process-level context. Stack commands skip this — they have
  // their own targeting (positional system IDs, etc).
  program.hook("preAction", async (thisCmd, actionCmd) => {
    if (isUnderStack(actionCmd)) return;

    const opts = thisCmd.opts();
    const flags: ResolverFlags = {
      system: typeof opts.system === "string" ? opts.system : undefined,
      url: typeof opts.url === "string" ? opts.url : undefined,
      key: typeof opts.key === "string" ? opts.key : undefined,
      timeout: typeof opts.timeout === "number" ? opts.timeout : undefined,
    };
    const ctx = await resolveAgentOSTarget(flags);
    setAgentOSContext(ctx);
  });

  // All stack-management commands live under `ixora stack <cmd>`.
  // The top-level command surface is reserved for AgentOS runtime commands
  // (agents, teams, traces, sessions, ...) ported from agno-cli.
  const stackCmd = program
    .command("stack")
    .description(
      "Manage the local Ixora stack (install, start/stop, config, systems, models)",
    );

  stackCmd
    .command("install")
    .description("First-time setup (interactive)")
    .action(async () => {
      const opts = program.opts();
      await cmdInstall(opts);
    });

  stackCmd
    .command("start")
    .argument("[service]", "Service to start (omit for all)")
    .description("Start all services, or a specific service by name")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdStart(opts, service);
    });

  stackCmd
    .command("stop")
    .argument("[service]", "Service to stop (omit for all)")
    .description("Stop all services, or a specific service by name")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdStop(opts, service);
    });

  stackCmd
    .command("restart")
    .argument("[service]", "Service to restart (omit for all)")
    .description("Restart all services, or a specific service by name")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdRestart(opts, service);
    });

  stackCmd
    .command("status")
    .description("Show service status and deployed profile")
    .action(async () => {
      const opts = program.opts();
      await cmdStatus(opts);
    });

  stackCmd
    .command("upgrade")
    .description("Pull latest images and restart")
    .argument("[version]", "Target version (e.g., 0.0.11 or v0.0.11)")
    .action(async (version?: string) => {
      const opts = program.opts();
      await cmdUpgrade({ ...opts, version });
    });

  stackCmd
    .command("uninstall")
    .description("Stop services and remove images")
    .action(async () => {
      const opts = program.opts();
      await cmdUninstall(opts);
    });

  stackCmd
    .command("logs")
    .argument("[service]", "Service to show logs for (omit for all)")
    .description("Tail service logs")
    .action(async (service?: string) => {
      const opts = program.opts();
      await cmdLogs(opts, service);
    });

  stackCmd
    .command("version")
    .description("Show CLI and image versions")
    .action(async () => {
      const opts = program.opts();
      await cmdVersion(opts);
    });

  // Config subcommands
  const configCmd = stackCmd
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
    .argument("[system]", "System ID — open Full/Custom picker for that system; omit to edit .env")
    .description("Open configuration in your editor, or switch a system between Full and Custom")
    .action(async (system?: string) => {
      if (system) {
        await cmdSystemConfigEdit(system);
      } else {
        await cmdConfigEdit();
      }
    });

  configCmd
    .command("reset")
    .argument("<system>", "System ID — drop custom profile and revert to Full")
    .description("Reset a system to Full mode (custom profile YAML is backed up to .bak)")
    .action((system: string) => {
      cmdSystemConfigReset(system);
    });

  configCmd
    .command("show-system")
    .alias("show-sys")
    .argument("<system>", "System ID")
    .description("Show a system's mode and resolved component list")
    .action(async (system: string) => {
      await cmdSystemConfigShow(system);
    });

  // `ixora stack agents [system]` — focused entry point for editing the agents
  // enabled on a system. Identical plumbing to `config edit <system>` but
  // skips the Full/Custom prompt (picking implies Custom). Falls back to
  // a system picker when no system arg is supplied.
  stackCmd
    .command("agents")
    .argument("[system]", "System ID — omit to pick interactively")
    .description("Edit the agents enabled on a system (opens the component picker)")
    .action(async (system?: string) => {
      await cmdAgentsEdit(system);
    });

  // `ixora stack components list` — pretty-print the component manifest from
  // the installed image so users authoring custom profiles can discover IDs.
  const componentsCmd = stackCmd
    .command("components")
    .description("Inspect the components the installed image declares");

  componentsCmd
    .command("list", { isDefault: true })
    .option("--refresh", "Re-fetch the manifest from the image (ignore cache)")
    .option(
      "--image <ref>",
      "Override the image reference used to fetch the manifest",
    )
    .description("List every component (agents, teams, workflows, knowledge)")
    .action(async (opts: { refresh?: boolean; image?: string }) => {
      await cmdComponentsList(opts);
    });

  // System subcommands
  const systemCmd = stackCmd
    .command("system")
    .description("Manage IBM i systems (add, remove, list)");

  systemCmd
    .command("add")
    .description(
      "Add a system: managed (provision a new ixora stack) or external (register an AgentOS URL)",
    )
    .option(
      "--kind <kind>",
      "Skip the kind prompt: 'managed' or 'external'",
    )
    .option("--id <id>", "Pre-fill the system ID")
    .option("--name <name>", "Pre-fill the display name")
    .option(
      "--url <url>",
      "External only: pre-fill the AgentOS URL (e.g. http://localhost:8080)",
    )
    .option(
      "--key <key>",
      "External only: pre-fill the AgentOS API key (optional)",
    )
    .action(
      async (opts: {
        kind?: string;
        id?: string;
        name?: string;
        url?: string;
        key?: string;
      }) => {
        const kind =
          opts.kind === "managed" || opts.kind === "external"
            ? opts.kind
            : undefined;
        if (opts.kind && !kind) {
          console.error(
            `Invalid --kind '${opts.kind}'. Use 'managed' or 'external'.`,
          );
          process.exit(1);
        }
        await cmdSystemAdd({
          kind,
          id: opts.id,
          name: opts.name,
          url: opts.url,
          key: opts.key,
        });
      },
    );

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
    .argument("<id>", "System ID (from ixora stack system list)")
    .description("Start a specific system's services")
    .action(async (id: string) => {
      await cmdSystemStart(id);
    });

  systemCmd
    .command("stop")
    .argument("<id>", "System ID (from ixora stack system list)")
    .description("Stop a specific system's services")
    .action(async (id: string) => {
      await cmdSystemStop(id);
    });

  systemCmd
    .command("restart")
    .argument("<id>", "System ID (from ixora stack system list)")
    .description("Restart a specific system's services")
    .action(async (id: string) => {
      await cmdSystemRestart(id);
    });

  systemCmd
    .command("default")
    .argument(
      "[id]",
      "System ID to set as the default; omit to show the current default",
    )
    .option("--clear", "Unset the default system")
    .description(
      "Set, show, or clear the default system used when 2+ are running and --system is omitted",
    )
    .action((id: string | undefined, opts: { clear?: boolean }) => {
      cmdSystemDefault(id, opts);
    });

  // Models subcommands
  const modelsCmd = stackCmd
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

  // ── Mount the ported agno tree at top level ────────────────────────────
  program.addCommand(agentsCommand);
  program.addCommand(teamsCommand);
  program.addCommand(workflowsCommand);
  program.addCommand(tracesCommand);
  program.addCommand(sessionsCommand);
  program.addCommand(memoriesCommand);
  program.addCommand(knowledgeCommand);
  program.addCommand(evalsCommand);
  program.addCommand(approvalsCommand);
  program.addCommand(schedulesCommand);
  program.addCommand(metricsCommand);
  program.addCommand(databasesCommand);
  program.addCommand(registriesCommand);
  program.addCommand(agnoComponentsCommand);
  program.addCommand(agnoModelsCommand);
  program.addCommand(agnoStatusCommand);

  return program;
}

/**
 * Walk a command's parent chain looking for the `stack` group. Used by the
 * preAction hook to skip AgentOS resolution for stack-management commands.
 */
function isUnderStack(cmd: Command): boolean {
  let c: Command | null = cmd;
  while (c) {
    if (c.name() === "stack") return true;
    c = c.parent;
  }
  return false;
}
