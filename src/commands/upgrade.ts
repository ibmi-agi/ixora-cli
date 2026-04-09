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
import { info, success, die } from "../lib/ui.js";
import { VALID_PROFILES, type ProfileName } from "../lib/constants.js";

interface UpgradeOptions {
  runtime?: string;
  imageVersion?: string;
  profile?: string;
  pull?: boolean;
}

export async function cmdUpgrade(opts: UpgradeOptions): Promise<void> {
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

  info("Upgrading ixora...");

  // Update compose file
  writeComposeFile();
  success("Wrote docker-compose.yml");

  if (opts.imageVersion) {
    info(`Pinning version to: ${opts.imageVersion}`);
    updateEnvKey("IXORA_VERSION", opts.imageVersion);
  }

  if (opts.profile) {
    if (!VALID_PROFILES.includes(opts.profile as ProfileName)) {
      die(
        `Invalid profile: ${opts.profile} (choose: ${VALID_PROFILES.join(", ")})`,
      );
    }
    info(`Setting profile: ${opts.profile}`);
    updateEnvKey("IXORA_PROFILE", opts.profile);
  }

  if (opts.pull !== false) {
    info("Pulling latest images...");
    await runCompose(composeCmd, ["pull"]);
  }

  info("Restarting services...");
  await runCompose(composeCmd, ["up", "-d"]);

  await waitForHealthy(composeCmd);

  console.log();
  success("Upgrade complete!");
  console.log();
}
