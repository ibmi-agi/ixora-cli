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
import { die } from "../lib/ui.js";
import { resolveStackProfile } from "../lib/profile.js";

interface LogsOptions {
  runtime?: string;
  profile?: string;
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

  const profile = resolveStackProfile(opts);

  if (service) {
    const svc = resolveService(service);
    if (svc === "ui" && profile !== "full") {
      die(
        `ui is not in the active stack profile (${profile}); only 'full' includes the UI. ` +
          "Use --profile full or omit --profile.",
      );
    }
    if (svc.startsWith("mcp-") && profile === "cli") {
      die(
        `${svc} is not started in the 'cli' stack profile (agents use the bundled ibmi CLI). ` +
          "Use --profile mcp or --profile full.",
      );
    }
    await runCompose(composeCmd, ["logs", "-f", svc], { profile });
  } else {
    await runCompose(composeCmd, ["logs", "-f"], { profile });
  }
}
