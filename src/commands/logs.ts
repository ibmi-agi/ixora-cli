import { requireComposeFile, runCompose, resolveService } from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { die } from "../lib/ui.js";

interface LogsOptions {
  runtime?: string;
}

export async function cmdLogs(
  opts: LogsOptions,
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
    await runCompose(composeCmd, ["logs", "-f", svc]);
  } else {
    await runCompose(composeCmd, ["logs", "-f"]);
  }
}
