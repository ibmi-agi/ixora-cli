import { requireComposeFile, runCompose } from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { info, success, die } from "../lib/ui.js";

interface StopOptions {
  runtime?: string;
}

export async function cmdStop(opts: StopOptions): Promise<void> {
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

  info("Stopping ixora services...");
  await runCompose(composeCmd, ["down"]);

  success("Services stopped");
}
