import { existsSync, rmSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { runCompose } from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { IXORA_DIR, COMPOSE_FILE } from "../lib/constants.js";
import { info, success, die, bold, dim } from "../lib/ui.js";
import { homedir } from "node:os";
import { join } from "node:path";

interface UninstallOptions {
  runtime?: string;
  purge?: boolean;
}

export async function cmdUninstall(opts: UninstallOptions): Promise<void> {
  let composeCmd;
  try {
    composeCmd = await detectComposeCmd(opts.runtime);
    await verifyRuntimeRunning(composeCmd);
  } catch (e: unknown) {
    die((e as Error).message);
  }
  detectPlatform();

  if (opts.purge) {
    console.log(
      chalk.yellow(
        "This will remove all containers, images, volumes, and configuration.",
      ),
    );
    console.log(
      chalk.yellow(
        "All agent data (sessions, memory) will be permanently deleted.",
      ),
    );
  } else {
    console.log(chalk.yellow("This will stop containers and remove images."));
    console.log(
      dim(
        `Configuration in ${IXORA_DIR} will be preserved. Run 'ixora start' to re-pull and restart.`,
      ),
    );
  }

  const confirmed = await confirm({
    message: "Continue?",
    default: false,
  });

  if (!confirmed) {
    info("Cancelled");
    return;
  }

  if (existsSync(COMPOSE_FILE)) {
    info("Stopping services and removing images...");
    try {
      // Uninstall always tears down the FULL stack (incl. profile-gated
      // services like the UI) regardless of the active stack profile —
      // there should be nothing left running afterward.
      if (opts.purge) {
        await runCompose(composeCmd, ["down", "--rmi", "all", "-v"], {
          profile: "full",
        });
      } else {
        await runCompose(composeCmd, ["down", "--rmi", "all"], {
          profile: "full",
        });
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  if (opts.purge) {
    info(`Removing ${IXORA_DIR}...`);
    rmSync(IXORA_DIR, { recursive: true, force: true });
  }

  success("ixora has been uninstalled");

  if (!opts.purge) {
    console.log(`  Configuration preserved in ${dim(IXORA_DIR)}`);
    console.log(`  Run ${bold("ixora start")} to re-pull images and restart.`);
    console.log(
      `  Run ${bold("ixora uninstall --purge")} to remove everything.`,
    );
  }

  const binPath = join(homedir(), ".local", "bin", "ixora");
  if (existsSync(binPath)) {
    console.log(
      `  The ${bold("ixora")} command is still available at ${dim(binPath)}`,
    );
    console.log(`  To remove it: ${bold(`rm ${binPath}`)}`);
  }
}
