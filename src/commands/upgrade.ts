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
import { info, warn, error, die, bold } from "../lib/ui.js";
import { printRunningBanner } from "../lib/banner.js";
import { VALID_PROFILES, type ProfileName } from "../lib/constants.js";
import { fetchImageTags, normalizeVersion } from "../lib/registry.js";

interface UpgradeOptions {
  runtime?: string;
  imageVersion?: string;
  version?: string;
  profile?: string;
  pull?: boolean;
}

function rollback(previousVersion: string): void {
  warn("Rolling back to previous version...");
  updateEnvKey("IXORA_VERSION", previousVersion);
  writeComposeFile();
  info(`Reverted IXORA_VERSION to ${previousVersion}`);
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
        name: t === previousVersion ? `${t} (current)` : t,
      })),
    });
  }

  info(`Upgrading ixora: ${previousVersion} -> ${targetVersion}`);

  // Persist previous version for rollback support
  updateEnvKey("IXORA_PREVIOUS_VERSION", previousVersion);

  // Stop services -- downtime is acceptable
  info("Stopping services...");
  await runCompose(composeCmd, ["down", "--remove-orphans"]);

  // Write new version to .env so compose pull resolves correct image tags
  updateEnvKey("IXORA_VERSION", targetVersion);
  writeComposeFile();
  info("Wrote docker-compose.yml");

  if (opts.profile) {
    if (!VALID_PROFILES.includes(opts.profile as ProfileName)) {
      die(
        `Invalid profile: ${opts.profile} (choose: ${VALID_PROFILES.join(", ")})`,
      );
    }
    info(`Setting profile: ${opts.profile}`);
    updateEnvKey("IXORA_PROFILE", opts.profile);
  }

  try {
    // Pull images -- if this fails, rollback .env
    if (opts.pull !== false) {
      info("Pulling images...");
      await runCompose(composeCmd, ["pull"], { throwOnError: true });
    }

    // Start services
    info("Starting services...");
    await runCompose(composeCmd, ["up", "-d"], { throwOnError: true });

    // Health validation -- check return value
    const healthy = await waitForHealthy(composeCmd);
    if (!healthy) {
      throw new Error(
        "Services did not become healthy after upgrade",
      );
    }
  } catch (err) {
    // Automatic rollback on any failure
    rollback(previousVersion);

    // Stop broken services so user isn't left with unhealthy containers
    try {
      await runCompose(composeCmd, ["down", "--remove-orphans"]);
    } catch {
      // Best-effort stop -- don't mask the original error
    }

    error((err as Error).message);
    info(
      `Run ${bold("ixora logs")} to investigate, then retry with ${bold(`ixora upgrade ${targetVersion}`)}`,
    );
    process.exit(1);
  }

  printRunningBanner({
    title: "Upgrade complete!",
    version: targetVersion,
    previousVersion,
  });
}
