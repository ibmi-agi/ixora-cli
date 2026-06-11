import { execa } from "execa";
import ora from "ora";
import { type ComposeCmd, getRuntimeBin } from "./platform.js";
import { parseComposePs, runComposeCapture } from "./compose.js";
import { success, warn, error, bold } from "./ui.js";
import { HEALTH_TIMEOUT } from "./constants.js";

export interface WaitForHealthyOptions {
  timeout?: number;
  /** Specific api service to wait on (e.g. "api-default"). Default: first api-* service. */
  service?: string;
}

/**
 * Find the API container name in `compose ps --format json` output.
 *
 * Uses the normalized parser so it works for both docker compose v2
 * (ixora-api-default-1) and podman-compose (ixora_api-default_1) naming.
 */
export function findApiContainerName(
  psJson: string,
  service?: string,
): string {
  const entry = parseComposePs(psJson).find((e) =>
    service ? e.Service === service : /^api-/.test(e.Service ?? ""),
  );
  return entry?.Name ?? "";
}

export async function waitForHealthy(
  composeCmd: ComposeCmd,
  options: WaitForHealthyOptions = {},
): Promise<boolean> {
  const timeout = options.timeout ?? HEALTH_TIMEOUT;
  const spinner = ora("Waiting for services to become healthy...").start();
  const runtime = getRuntimeBin(composeCmd);

  // Find the primary API container
  let apiContainer = "";
  try {
    const output = await runComposeCapture(composeCmd, [
      "ps",
      "--format",
      "json",
    ]);
    apiContainer = findApiContainerName(output, options.service);
  } catch {
    // Ignore errors finding container
  }

  if (!apiContainer) {
    spinner.stop();
    warn("Could not find API container — skipping health check");
    return true;
  }

  spinner.text = `Waiting for services to become healthy (up to ${timeout}s)...`;

  let elapsed = 0;
  while (elapsed < timeout) {
    try {
      const stateResult = await execa(runtime, [
        "inspect",
        "--format",
        "{{.State.Status}}",
        apiContainer,
      ]);
      const state = stateResult.stdout.trim();

      if (state === "exited" || state === "dead") {
        spinner.fail("API container failed to start");
        console.log(`\n  Run ${bold("ixora stack logs api")} to investigate.`);
        return false;
      }

      const healthResult = await execa(runtime, [
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        apiContainer,
      ]);
      const health = healthResult.stdout.trim();

      if (health === "healthy") {
        spinner.succeed("Services are healthy");
        return true;
      }
    } catch {
      // Container might not exist yet, keep waiting
    }

    await new Promise((r) => setTimeout(r, 2000));
    elapsed += 2;
    spinner.text = `Waiting for services to become healthy (${elapsed}s/${timeout}s)...`;
  }

  spinner.warn(
    `Services did not become healthy within ${timeout}s — they may still be starting`,
  );
  console.log(`  Run ${bold("ixora stack logs api")} to investigate.`);
  return false;
}
