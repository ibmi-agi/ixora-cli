import {
  requireComposeFile,
  runCompose,
  resolveService,
} from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { info, success, die } from "../lib/ui.js";
import { resolveStackProfile } from "../lib/profile.js";

interface StopOptions {
  runtime?: string;
  profile?: string;
}

export async function cmdStop(
  opts: StopOptions,
  service?: string,
): Promise<void> {
  try {
    requireComposeFile();
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

  if (service) {
    const svc = resolveService(service);
    info(`Stopping ${svc}...`);
    await runCompose(composeCmd, ["stop", svc], { profile });
    success(`Stopped ${svc}`);
    return;
  }

  // For `full`, preserve today's behavior: `compose down --remove-orphans`
  // tears down containers + networks for the active profile. For `mcp`/`cli`,
  // use `compose stop` so a UI container left over from a prior `--profile
  // full` run is NOT touched (compose's profile gating skips services with
  // `profiles: ["full"]` when --profile full is not active).
  if (profile === "full") {
    info(`Stopping ixora services (profile: ${profile})...`);
    await runCompose(composeCmd, ["down", "--remove-orphans"], { profile });
  } else {
    info(`Stopping ixora services (profile: ${profile})...`);
    await runCompose(composeCmd, ["stop"], { profile });
  }

  success("Services stopped");
}
