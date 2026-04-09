import { select } from "@inquirer/prompts";
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
import { info, success, warn, die, dim, bold } from "../lib/ui.js";
import { VALID_PROFILES, type ProfileName } from "../lib/constants.js";
import { fetchImageTags, normalizeVersion } from "../lib/registry.js";

interface UpgradeOptions {
  runtime?: string;
  imageVersion?: string;
  version?: string;
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

  // Resolve target version: positional arg > --image-version > interactive select
  let targetVersion: string;
  const explicitVersion = opts.version || opts.imageVersion;

  if (explicitVersion) {
    targetVersion = normalizeVersion(explicitVersion);
  } else {
    // Fetch available versions and prompt
    let tags: string[];
    try {
      tags = await fetchImageTags("ibmi-agi/ixora-api");
    } catch {
      warn("Could not fetch available versions from registry");
      die("Specify a version: ixora upgrade <version>");
    }

    if (tags.length === 0) {
      die("No release versions found in registry");
    }

    targetVersion = await select<string>({
      message: "Select version to upgrade to",
      choices: tags.map((t) => ({
        value: t,
        name:
          t === previousVersion ? `${t} (current)` : t,
      })),
    });
  }

  info(`Upgrading ixora: ${previousVersion} → ${targetVersion}`);

  // Stop existing services to avoid port conflicts with orphaned containers
  info("Stopping services...");
  await runCompose(composeCmd, ["down", "--remove-orphans"]);

  // Pin version and regenerate compose
  updateEnvKey("IXORA_VERSION", targetVersion);
  writeComposeFile();
  success("Wrote docker-compose.yml");

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
    info("Pulling images...");
    await runCompose(composeCmd, ["pull"]);
  }

  info("Restarting services...");
  await runCompose(composeCmd, ["up", "-d"]);

  await waitForHealthy(composeCmd);

  const profile = envGet("IXORA_PROFILE") || "full";

  console.log();
  success("Upgrade complete!");
  console.log(`  ${bold("Version:")} ${targetVersion}`);
  console.log(`  ${bold("Profile:")} ${profile}`);
  if (previousVersion !== targetVersion) {
    console.log(`  ${dim(`(was ${previousVersion})`)}`);
  }
  console.log();
}
