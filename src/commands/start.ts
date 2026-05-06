import {
  requireInstalled,
  writeComposeFile,
  runCompose,
  resolveService,
} from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { waitForHealthy } from "../lib/health.js";
import { info, success, die } from "../lib/ui.js";
import { printRunningBanner } from "../lib/banner.js";
import {
  resolveStackProfile,
  persistStackProfile,
  wasProfileExplicit,
} from "../lib/profile.js";

interface StartOptions {
  runtime?: string;
  profile?: string;
  pull?: boolean;
}

export async function cmdStart(
  opts: StartOptions,
  service?: string,
): Promise<void> {
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

  // Regenerate compose file for current system count
  writeComposeFile();

  if (service) {
    const svc = resolveService(service);
    info(`Starting ${svc} (profile: ${profile})...`);
    await runCompose(composeCmd, ["up", "-d", svc], { profile });
    await waitForHealthy(composeCmd);
    success(`Started ${svc}`);
    return;
  }

  success("Wrote docker-compose.yml");
  info(`Starting ixora services (profile: ${profile})...`);
  await runCompose(composeCmd, ["up", "-d", "--remove-orphans"], { profile });

  await waitForHealthy(composeCmd);

  printRunningBanner({ profile });
}
