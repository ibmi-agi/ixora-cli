// `ixora chat` — interactive TUI REPL for agents, teams, and workflows.
//
// This command opts OUT of the root preAction resolver hook (src/cli.ts) so
// it can prompt the user to pick a system on ambiguity instead of exiting.
// It must call setAgentOSContext() before the first getClient() — the
// controller's discovery is the first client use.

import { Command, Option } from "commander";
import { select } from "@inquirer/prompts";
import { writeError } from "../lib/agentos-output.js";
import {
  ResolverError,
  resolveAgentOSTarget,
  type ResolverFlags,
} from "../lib/agentos-resolver.js";
import { setAgentOSContext } from "../lib/agentos-context.js";
import type { SystemConfig } from "../lib/systems.js";
import { applyColorMode, buildChatTheme } from "../lib/chat/theme.js";
import { ChatApp } from "../lib/chat/app.js";
import { ChatController } from "../lib/chat/runner.js";
import type { EntityKind } from "../lib/chat/components/pickers.js";

function isPromptCancellation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    ((err as { name?: unknown }).name === "ExitPromptError" ||
      (err as { name?: unknown }).name === "AbortPromptError")
  );
}

/**
 * Prompt the user to pick between the available systems. Honors the same
 * default-first ordering the resolver uses: when IXORA_DEFAULT_SYSTEM is set
 * (but unavailable, or it would have been auto-picked) it is listed first if
 * present; the rest keep config order.
 */
async function promptSystemPick(
  available: SystemConfig[],
  defaultSystemId: string | undefined,
): Promise<string | null> {
  const ordered = [...available].sort((a, b) =>
    a.id === defaultSystemId ? -1 : b.id === defaultSystemId ? 1 : 0,
  );
  try {
    return await select<string>({
      message: "Multiple systems are available — pick one to chat against",
      choices: ordered.map((s) => ({
        name: s.kind === "external" ? `${s.id} (external · ${s.url})` : s.id,
        value: s.id,
      })),
    });
  } catch (err) {
    if (isPromptCancellation(err)) return null;
    throw err;
  }
}

export const chatCommand = new Command("chat")
  .description(
    "Interactive chat TUI: stream agent/team/workflow runs with tool " +
      "rendering and human-in-the-loop confirmations (TTY only)",
  )
  .addOption(
    new Option("--agent <id>", "chat with this agent").conflicts([
      "team",
      "workflow",
    ]),
  )
  .addOption(
    new Option("--team <id>", "chat with this team").conflicts([
      "agent",
      "workflow",
    ]),
  )
  .addOption(
    new Option("--workflow <id>", "run this workflow").conflicts([
      "agent",
      "team",
    ]),
  )
  .option("--session <id>", "resume an existing session")
  .option(
    "--bypass-confirmations",
    "auto-approve confirmation-gated tools (demo mode)",
  )
  .action(async (opts, cmd: Command) => {
    // TTY guard first: the TUI owns stdin AND stdout. A piped stdout would
    // otherwise silently flip output formatting (getOutputFormat) — refuse.
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      writeError(
        "'ixora chat' requires an interactive terminal. For scripted runs use `ixora agents run`.",
      );
      process.exitCode = 1;
      return;
    }

    const globals = cmd.optsWithGlobals();
    applyColorMode(globals.color !== false);

    // Self-resolution (the preAction hook skips chat): same flags, but
    // ambiguity prompts instead of exiting.
    const flags: ResolverFlags = {
      system: typeof globals.system === "string" ? globals.system : undefined,
      url: typeof globals.url === "string" ? globals.url : undefined,
      key: typeof globals.key === "string" ? globals.key : undefined,
      timeout:
        typeof globals.timeout === "number" ? globals.timeout : undefined,
    };
    let ctx;
    try {
      ctx = await resolveAgentOSTarget(flags);
    } catch (err) {
      if (
        err instanceof ResolverError &&
        err.reason === "ambiguous" &&
        err.available &&
        err.available.length > 0
      ) {
        const picked = await promptSystemPick(
          err.available,
          err.defaultSystemId,
        );
        if (picked === null) {
          // Prompt cancelled (Ctrl+C/Esc): quiet exit, conventional code.
          process.exitCode = 130;
          return;
        }
        ctx = await resolveAgentOSTarget({ ...flags, system: picked });
      } else if (err instanceof ResolverError) {
        writeError(err.message);
        process.exitCode = 1;
        return;
      } else {
        throw err;
      }
    }
    setAgentOSContext(ctx);

    const entity: { kind: EntityKind; id: string } | undefined =
      typeof opts.agent === "string"
        ? { kind: "agent", id: opts.agent }
        : typeof opts.team === "string"
          ? { kind: "team", id: opts.team }
          : typeof opts.workflow === "string"
            ? { kind: "workflow", id: opts.workflow }
            : undefined;

    const theme = buildChatTheme();
    const app = new ChatApp(theme);
    const controller = new ChatController(app, theme, cmd);
    await controller.start({
      entity,
      sessionId: typeof opts.session === "string" ? opts.session : undefined,
      bypassConfirmations: opts.bypassConfirmations === true,
    });
  });
