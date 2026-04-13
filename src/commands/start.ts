import { updateEnvKey } from "../lib/env.js";
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
import { info, success, die } from "../lib/ui.js";
import { printRunningBanner } from "../lib/banner.js";
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

  printRunningBanner();
}
