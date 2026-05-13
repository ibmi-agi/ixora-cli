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
import { fetchImageTags, normalizeVersion } from "../lib/registry.js";
import {
  resolveStackProfile,
  persistStackProfile,
  wasProfileExplicit,
} from "../lib/profile.js";
import { readSystems } from "../lib/systems.js";
import { ensureManifest, manifestComponentIds } from "../lib/manifest.js";
import type { Manifest } from "../lib/manifest.js";
import { readUserProfile, writeUserProfile } from "../lib/profiles.js";

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

  const profile = resolveStackProfile(opts);
  if (wasProfileExplicit(opts)) {
    info(`Setting stack profile: ${profile}`);
    persistStackProfile(profile);
  }

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

  info(`Upgrading ixora: ${previousVersion} -> ${targetVersion} (profile: ${profile})`);

  // Persist previous version for rollback support
  updateEnvKey("IXORA_PREVIOUS_VERSION", previousVersion);

  // Stop services -- downtime is acceptable. Profile-scoped so a co-resident
  // container outside the active profile (e.g. UI when profile=api) is left
  // alone.
  info("Stopping services...");
  await runCompose(composeCmd, ["down", "--remove-orphans"], { profile });

  // Write new version to .env so compose pull resolves correct image tags
  updateEnvKey("IXORA_VERSION", targetVersion);
  writeComposeFile();
  info("Wrote docker-compose.yml");

  try {
    // Pull images -- if this fails, rollback .env
    if (opts.pull !== false) {
      info("Pulling images...");
      await runCompose(composeCmd, ["pull"], { throwOnError: true, profile });
    }

    // Refresh manifest from the freshly-pulled image and reconcile each
    // system's custom profile with what the new image actually exposes.
    // Failures here are non-fatal — the API container will reject any
    // truly-missing IDs at boot, surfacing the same error loudly.
    try {
      const imageRef = `ghcr.io/ibmi-agi/ixora-api:${targetVersion}`;
      const manifest = await ensureManifest(imageRef, { force: true });
      await reconcileCustomProfiles(manifest);
    } catch (e) {
      warn(
        `Could not refresh component manifest: ${(e as Error).message}. ` +
          "Custom profiles will be validated by the API container instead.",
      );
    }

    // Start services
    info("Starting services...");
    await runCompose(composeCmd, ["up", "-d"], {
      throwOnError: true,
      profile,
    });

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
      await runCompose(composeCmd, ["down", "--remove-orphans"], { profile });
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
    profile,
  });
}

/**
 * For each Custom-mode system, drop any component IDs the new image no
 * longer ships. We don't add new ones — Custom is opt-in, so a user
 * who wanted "only security" doesn't want a refresh to silently grow
 * their selection. New agents in the manifest still surface in
 * `ixora components list` and `ixora config edit`.
 */
async function reconcileCustomProfiles(manifest: Manifest): Promise<void> {
  const systems = readSystems().filter((s) => s.mode === "custom");
  if (systems.length === 0) return;

  const known = manifestComponentIds(manifest);
  for (const sys of systems) {
    const profile = readUserProfile(sys.id);
    if (!profile) continue;

    let changed = false;
    for (const kind of ["agents", "teams", "workflows", "knowledge"] as const) {
      const filtered = profile[kind].filter((id) => known.has(`${kind}:${id}`));
      if (filtered.length !== profile[kind].length) {
        const removed = profile[kind].filter(
          (id) => !known.has(`${kind}:${id}`),
        );
        warn(
          `System '${sys.id}': removed ${kind} no longer in this image — ${removed.join(", ")}`,
        );
        profile[kind] = filtered;
        changed = true;
      }
    }
    if (changed) writeUserProfile(sys.id, profile);
  }
}
