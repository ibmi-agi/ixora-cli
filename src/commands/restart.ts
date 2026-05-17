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
import { printRunningBanner, printUsageBanner } from "../lib/banner.js";
import {
  resolveStackProfile,
  persistStackProfile,
  wasProfileExplicit,
} from "../lib/profile.js";

interface RestartOptions {
  runtime?: string;
  profile?: string;
}

export async function cmdRestart(
  opts: RestartOptions,
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
    persistStackProfile(profile);
  }

  // Regenerate compose file for current system count
  writeComposeFile();

  if (service) {
    const svc = resolveService(service);
    info(`Restarting ${svc} (profile: ${profile})...`);
    await runCompose(
      composeCmd,
      ["up", "-d", "--force-recreate", "--no-deps", svc],
      { profile },
    );
    success(`Restarted ${svc}`);
  } else {
    info(`Restarting all services (profile: ${profile})...`);
    await runCompose(
      composeCmd,
      ["up", "-d", "--force-recreate", "--remove-orphans"],
      { profile },
    );
    await waitForHealthy(composeCmd);
    printRunningBanner({ profile });
    printUsageBanner();
  }
}
