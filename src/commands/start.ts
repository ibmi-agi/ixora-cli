import chalk from "chalk";
import { envGet, updateEnvKey } from "../lib/env.js";
import {
  requireInstalled,
  writeComposeFile,
  runCompose,
} from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { waitForHealthy } from "../lib/health.js";
import { totalSystemCount, readSystems } from "../lib/systems.js";
import { info, success, die, dim, bold } from "../lib/ui.js";
import { VALID_PROFILES, type ProfileName } from "../lib/constants.js";

interface StartOptions {
  runtime?: string;
  profile?: string;
  pull?: boolean;
}

export async function cmdStart(opts: StartOptions): Promise<void> {
  try {
    requireInstalled();
  } catch (e: unknown) {
    die((e as Error).message);
  }

  let composeCmd;
  try {
    composeCmd = await detectComposeCmd(opts.runtime);
    await verifyRuntimeRunning(composeCmd);
  } catch (e: unknown) {
    die((e as Error).message);
  }
  detectPlatform();

  // Update profile if specified
  if (opts.profile) {
    if (!VALID_PROFILES.includes(opts.profile as ProfileName)) {
      die(
        `Invalid profile: ${opts.profile} (choose: ${VALID_PROFILES.join(", ")})`,
      );
    }
    info(`Setting profile: ${opts.profile}`);
    updateEnvKey("IXORA_PROFILE", opts.profile);
  }

  // Regenerate compose file for current system count
  writeComposeFile();
  success("Wrote docker-compose.yml");

  info("Starting ixora services...");
  await runCompose(composeCmd, ["up", "-d", "--remove-orphans"]);

  await waitForHealthy(composeCmd);

  const profile = envGet("IXORA_PROFILE") || "full";
  const total = totalSystemCount();

  console.log();
  success("ixora is running!");
  console.log(`  ${bold("UI:")}      http://localhost:3000`);
  console.log(`  ${bold("API:")}     http://localhost:8000`);
  console.log(`  ${bold("Profile:")} ${profile}`);

  if (total > 1) {
    console.log(`  ${bold("Systems:")} ${total}`);
    let port = 8000;
    const primaryHost = envGet("DB2i_HOST");
    if (primaryHost) {
      console.log(`    ${dim(`:${port} → default (${primaryHost})`)}`);
      port++;
    }
    const systems = readSystems();
    for (const sys of systems) {
      const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
      const sysHost = envGet(`SYSTEM_${idUpper}_HOST`);
      console.log(`    ${dim(`:${port} → ${sys.id} (${sysHost})`)}`);
      port++;
    }
    console.log(
      `  ${dim("Note: UI connects to primary system (:8000) only. Use API ports for other systems.")}`,
    );
  }
  console.log();
}
