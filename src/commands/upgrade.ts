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
import { info, success, die, dim, bold } from "../lib/ui.js";
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

  const previousVersion = envGet("IXORA_VERSION") || "latest";
  info("Upgrading ixora...");

  // Update compose file
  writeComposeFile();
  success("Wrote docker-compose.yml");

  if (opts.imageVersion) {
    info(`Pinning version: ${previousVersion} → ${opts.imageVersion}`);
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

  const newVersion = envGet("IXORA_VERSION") || "latest";
  const profile = envGet("IXORA_PROFILE") || "full";

  console.log();
  success("Upgrade complete!");
  console.log(`  ${bold("Version:")} ${newVersion}`);
  console.log(`  ${bold("Profile:")} ${profile}`);
  if (opts.imageVersion && previousVersion !== opts.imageVersion) {
    console.log(`  ${dim(`(was ${previousVersion})`)}`);
  }
  console.log();
}
