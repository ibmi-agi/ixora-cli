import { existsSync } from "node:fs";
import chalk from "chalk";
import { SCRIPT_VERSION, ENV_FILE, COMPOSE_FILE } from "../lib/constants.js";
import { envGet } from "../lib/env.js";
import { runComposeCapture } from "../lib/compose.js";
import { detectComposeCmd } from "../lib/platform.js";
import { dim } from "../lib/ui.js";

export async function cmdVersion(opts?: { runtime?: string }): Promise<void> {
  console.log(`ixora ${SCRIPT_VERSION}`);

  if (!existsSync(ENV_FILE)) return;

  const version = envGet("IXORA_VERSION") || "latest";
  const agentModel =
    envGet("IXORA_AGENT_MODEL") || "anthropic:claude-sonnet-4-6";

  console.log(`  images:  ${version}`);
  console.log(`  model:   ${agentModel}`);

  // Try to show actual running container images
  if (existsSync(COMPOSE_FILE)) {
    try {
      const composeCmd = await detectComposeCmd(opts?.runtime);
      const output = await runComposeCapture(composeCmd, [
        "images",
        "--format",
        "{{.Service}} {{.Repository}}:{{.Tag}}",
      ]);

      if (output.trim()) {
        console.log();
        console.log(`  ${chalk.bold("Running containers:")}`);
        for (const line of output.trim().split("\n")) {
          const [service, ...imageParts] = line.split(" ");
          const image = imageParts.join(" ");
          if (service && image) {
            console.log(`    ${service.padEnd(22)} ${dim(image)}`);
          }
        }
      }
    } catch {
      // Docker not running or compose not available — skip silently
    }
  }
}
