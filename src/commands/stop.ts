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

interface StopOptions {
  runtime?: string;
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

  if (service) {
    const svc = resolveService(service);
    info(`Stopping ${svc}...`);
    await runCompose(composeCmd, ["stop", svc]);
    success(`Stopped ${svc}`);
    return;
  }

  info("Stopping ixora services...");
  await runCompose(composeCmd, ["down"]);

  success("Services stopped");
}
