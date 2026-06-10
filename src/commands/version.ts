import { existsSync } from "node:fs";
import chalk from "chalk";
import { SCRIPT_VERSION, ENV_FILE, COMPOSE_FILE } from "../lib/constants.js";
import { envGet } from "../lib/env.js";
import { parseComposeImages, runComposeCapture } from "../lib/compose.js";
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
        "json",
      ]);

      if (output.trim()) {
        // Repository/Tag only exist in docker compose v2 images JSON —
        // skip the section when a podman-compose box returns podman's schema.
        const images = parseComposeImages(output).filter(
          (img) => img.Repository,
        );
        if (images.length > 0) {
          console.log();
          console.log(`  ${chalk.bold("Running containers:")}`);
          for (const img of images) {
            const tag = img.Tag || "unknown";
            const id = img.ID ? dim(` (${img.ID.slice(0, 12)})`) : "";
            const imageStr = `${img.Repository || ""}:${tag}${id}`;
            console.log(
              `    ${(img.Service || "").padEnd(22)} ${dim(imageStr)}`,
            );
          }
        }
      }
    } catch {
      // Docker not running or compose not available — skip silently
    }
  }
}
