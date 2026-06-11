import {
  Argument,
  Command,
  type Help,
  type HelpConfiguration,
  Option,
} from "commander";
import chalk from "chalk";
import { agentsCommand } from "./agentos/agents.js";
import { approvalsCommand } from "./agentos/approvals.js";
import { chatCommand } from "./agentos/chat.js";
import { componentsCommand as agnoComponentsCommand } from "./agentos/components.js";
import { databasesCommand } from "./agentos/databases.js";
import { docsCommand } from "./agentos/docs.js";
import { evalsCommand } from "./agentos/evals.js";
import { healthCommand } from "./agentos/health.js";
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
  resolveAgentOSTargetOrExit,
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
import { isStackHintName, registerStackHints } from "./lib/stack-hints.js";

/**
 * Custom help that lists Commands before Options. Mirrors Commander's
 * default formatHelp but swaps the order of the Commands and Options
 * sections, so `ixora --help` surfaces what users can do first and the
 * global flags second.
 */
const commandsFirstHelp: HelpConfiguration = {
  showGlobalOptions: true,
  formatHelp(cmd, helper) {
    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth ?? 80;
    const self = this as Help;

    const callFormatItem = (term: string, description: string) =>
      helper.formatItem(term, termWidth, description, helper);

    let output: string[] = [
      `${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`,
      "",
    ];

    const description = helper.commandDescription(cmd);
    if (description.length > 0) {
      output = output.concat([
        helper.boxWrap(
          helper.styleCommandDescription(description),
          helpWidth,
        ),
        "",
      ]);
    }

    const argumentList = helper.visibleArguments(cmd).map((arg) =>
      callFormatItem(
        helper.styleArgumentTerm(helper.argumentTerm(arg)),
        helper.styleArgumentDescription(helper.argumentDescription(arg)),
      ),
    );
    output = output.concat(
      self.formatItemList("Arguments:", argumentList, helper),
    );

    const commandGroups = self.groupItems(
      [...cmd.commands],
      helper.visibleCommands(cmd),
      (sub) => sub.helpGroup() || "Commands:",
    );
    commandGroups.forEach((commands, group) => {
      const commandList = commands.map((sub) =>
        callFormatItem(
          helper.styleSubcommandTerm(helper.subcommandTerm(sub)),
          helper.styleSubcommandDescription(helper.subcommandDescription(sub)),
        ),
      );
      output = output.concat(self.formatItemList(group, commandList, helper));
    });

    const optionGroups = self.groupItems(
      [...cmd.options],
      helper.visibleOptions(cmd),
      (option) => option.helpGroupHeading ?? "Options:",
    );
    optionGroups.forEach((options, group) => {
      const optionList = options.map((option) =>
        callFormatItem(
          helper.styleOptionTerm(helper.optionTerm(option)),
          helper.styleOptionDescription(helper.optionDescription(option)),
        ),
      );
      output = output.concat(self.formatItemList(group, optionList, helper));
    });

    if (helper.showGlobalOptions) {
      const globalOptionList = helper
        .visibleGlobalOptions(cmd)
        .map((option) =>
          callFormatItem(
            helper.styleOptionTerm(helper.optionTerm(option)),
            helper.styleOptionDescription(helper.optionDescription(option)),
          ),
        );
      output = output.concat(
        self.formatItemList("Global Options:", globalOptionList, helper),
      );
    }

    return output.join("\n");
  },
};

/**
 * Machine-readable snapshot of the command tree. Surfaced via `ixora help
 * --json` so agents can introspect the CLI without scraping `--help` text.
 */
interface CommandSchema {
  name: string;
  description: string;
  usage: string;
  args: Array<{
    name: string;
    required: boolean;
    description: string;
    choices?: readonly string[];
  }>;
  options: Array<{
    flags: string;
    description: string;
    default?: unknown;
    required: boolean;
    choices?: readonly string[];
  }>;
  commands: CommandSchema[];
}

function serializeCommand(cmd: Command): CommandSchema {
  const helper = cmd.createHelp();
  return {
    name: cmd.name(),
    description: cmd.description() || "",
    usage: cmd.usage() || "",
    args: helper.visibleArguments(cmd).map((a: Argument) => ({
      name: a.name(),
      required: a.required,
      description: a.description ?? "",
      choices: a.argChoices,
    })),
    options: helper.visibleOptions(cmd).map((o: Option) => ({
      flags: o.flags,
      description: o.description ?? "",
      default: o.defaultValue,
      required: o.mandatory ?? false,
      choices: o.argChoices,
    })),
    commands: helper
      .visibleCommands(cmd)
      .filter((c: Command) => c.name() !== "help")
      .map(serializeCommand),
  };
}

/**
 * Apply Commands-first help, normalized error output, and the help-after-error
 * hint to a command and every descendant. Commander's `configureOutput` and
 * `showHelpAfterError` are per-command (not inherited at lookup time), so
 * children handle their own parser errors with their own defaults unless we
 * walk the tree and set the same config everywhere.
 */
function applyOutputConfig(cmd: Command): void {
  cmd.configureHelp(commandsFirstHelp);
  cmd.configureOutput({
    outputError: (str, write) => {
      write(str.replace(/^error:/i, `${chalk.red("Error:")}`));
    },
  });
  cmd.showHelpAfterError("(run with --help for usage)");
  for (const sub of cmd.commands) {
    applyOutputConfig(sub);
  }
}

export function createProgram(): Command {
  const program = new Command()
    .name("ixora")
    .description("Manage ixora AI agent deployments on IBM i")
    .version(SCRIPT_VERSION, "-V, --cli-version", "Show CLI version number")
    .configureHelp(commandsFirstHelp)
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
      "Output format: json, table, or compact (compact applies to `agents run`/`agents continue`; auto-detects from TTY otherwise)",
    );

  // Disable the built-in help command so we can register our own with
  // `--json` for agent introspection. Output normalization (Error: prefix +
  // help-after-error hint) is applied recursively after all commands are
  // mounted — see applyOutputConfig() at end of createProgram().
  program.addHelpCommand(false);

  // The preAction hook fires before any subcommand's action. For commands
  // mounted directly under the root (the ported agno tree), we resolve the
  // AgentOS target from --system / .env / running-container state and stash
  // it on the process-level context. Stack commands skip this — they have
  // their own targeting (positional system IDs, etc).
  program.hook("preAction", async (thisCmd, actionCmd) => {
    if (isUnderStack(actionCmd)) return;
    // The hint shims (e.g. `ixora restart` → "use ixora stack restart") are
    // mounted as direct children of the root program. Only short-circuit
    // when the action command IS one of those top-level hints; matching by
    // leaf name alone would also catch e.g. `ixora knowledge config` whose
    // leaf name happens to be `config`.
    if (
      actionCmd.parent === program &&
      isStackHintName(actionCmd.name())
    ) {
      return;
    }
    // `ixora chat` resolves its own target inside its action so it can
    // prompt the user on ambiguity instead of exiting here.
    if (actionCmd.parent === program && actionCmd.name() === "chat") return;

    const opts = thisCmd.opts();
    const flags: ResolverFlags = {
      system: typeof opts.system === "string" ? opts.system : undefined,
      url: typeof opts.url === "string" ? opts.url : undefined,
      key: typeof opts.key === "string" ? opts.key : undefined,
      timeout: typeof opts.timeout === "number" ? opts.timeout : undefined,
    };
    const ctx = await resolveAgentOSTargetOrExit(flags);
    setAgentOSContext(ctx);
  });

  // All stack-management commands live under `ixora stack <cmd>`.
  // The top-level command surface is reserved for AgentOS runtime commands
  // (agents, teams, traces, sessions, ...) ported from agno-cli.
  const stackCmd = program
    .command("stack")
    .description(
      "Manage the local Ixora stack (install, start/stop, config, systems, models)",
    )
    .configureHelp(commandsFirstHelp)
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
    .option("--runtime <name>", "Force container runtime (docker or podman)");

  stackCmd
    .command("install")
    .description("First-time setup (interactive)")
    .action(async () => {
      await cmdInstall(stackCmd.opts());
    });

  stackCmd
    .command("start")
    .argument("[service]", "Service to start (omit for all)")
    .description("Start all services, or a specific service by name")
    .action(async (service?: string) => {
      await cmdStart(stackCmd.opts(), service);
    });

  stackCmd
    .command("stop")
    .argument("[service]", "Service to stop (omit for all)")
    .description("Stop all services, or a specific service by name")
    .action(async (service?: string) => {
      await cmdStop(stackCmd.opts(), service);
    });

  stackCmd
    .command("restart")
    .argument("[service]", "Service to restart (omit for all)")
    .description("Restart all services, or a specific service by name")
    .action(async (service?: string) => {
      await cmdRestart(stackCmd.opts(), service);
    });

  stackCmd
    .command("status")
    .description("Show service status and deployed profile")
    .action(async () => {
      await cmdStatus(stackCmd.opts());
    });

  stackCmd
    .command("upgrade")
    .description("Pull latest images and restart")
    .argument("[version]", "Target version (e.g., 0.0.11 or v0.0.11)")
    .action(async (version?: string) => {
      await cmdUpgrade({ ...stackCmd.opts(), version });
    });

  stackCmd
    .command("uninstall")
    .description("Stop services and remove images")
    .action(async () => {
      await cmdUninstall(stackCmd.opts());
    });

  stackCmd
    .command("logs")
    .argument("[service]", "Service to show logs for (omit for all)")
    .description("Tail service logs")
    .action(async (service?: string) => {
      await cmdLogs(stackCmd.opts(), service);
    });

  stackCmd
    .command("version")
    .description("Show CLI and image versions")
    .action(async () => {
      await cmdVersion(stackCmd.opts());
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
    // Deliberately NOT `--url`/`--key`: those are program-level globals for
    // AgentOS endpoint targeting. Commander parses globals from anywhere in
    // argv, so a colliding name here would be swallowed before reaching this
    // subcommand. The `agentos-` prefix keeps the registration flags distinct.
    .option(
      "--agentos-url <url>",
      "External only: pre-fill the AgentOS URL (e.g. http://localhost:8080)",
    )
    .option(
      "--agentos-key <key>",
      "External only: pre-fill the AgentOS API key (optional)",
    )
    .action(
      async (opts: {
        kind?: string;
        id?: string;
        name?: string;
        agentosUrl?: string;
        agentosKey?: string;
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
          url: opts.agentosUrl,
          key: opts.agentosKey,
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

  // Friendly hints for users who type `ixora restart` / `start` / etc. without
  // the `stack` prefix (those commands moved under `ixora stack` in v0.2.0).
  // Registered before the agno tree so shim names don't shadow real commands —
  // none of the hint names collide with top-level agno commands.
  registerStackHints(program);

  // ── Mount the ported agno tree at top level ────────────────────────────
  program.addCommand(agentsCommand);
  program.addCommand(chatCommand);
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
  program.addCommand(healthCommand);
  program.addCommand(docsCommand);

  // Custom `help [command]` that supports `--json` for agent introspection.
  // Registered after every other command so the JSON tree captures them all.
  program
    .command("help [command]")
    .description(
      "Display help for a command (pass --json to emit the full command tree)",
    )
    .action((commandName: string | undefined, _opts, cmd: Command) => {
      if (cmd.optsWithGlobals().json) {
        process.stdout.write(
          `${JSON.stringify(serializeCommand(program), null, 2)}\n`,
        );
        return;
      }
      const target = commandName
        ? program.commands.find((c) => c.name() === commandName)
        : program;
      if (!target) {
        process.stderr.write(
          `${chalk.red("Error:")} unknown command '${commandName}'. Run \`ixora help\` to see available commands.\n`,
        );
        process.exit(1);
      }
      target.outputHelp();
    });

  // Propagate help layout + error normalization to every command in the tree.
  // Done last so subcommands added via .addCommand() are covered.
  applyOutputConfig(program);

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
