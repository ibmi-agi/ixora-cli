import { requireComposeFile, runCompose, resolveService } from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { waitForHealthy } from "../lib/health.js";
import { info, success, die } from "../lib/ui.js";

interface RestartOptions {
  runtime?: string;
}

export async function cmdRestart(
  opts: RestartOptions,
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

  if (service) {
    const svc = resolveService(service);
    info(`Restarting ${svc}...`);
    await runCompose(composeCmd, [
      "up",
      "-d",
      "--force-recreate",
      "--no-deps",
      svc,
    ]);
    success(`Restarted ${svc}`);
  } else {
    info("Restarting all services...");
    await runCompose(composeCmd, ["up", "-d", "--force-recreate"]);
    await waitForHealthy(composeCmd);
    console.log();
    success("All services restarted");
  }
}
