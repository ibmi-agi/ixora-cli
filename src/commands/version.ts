import { existsSync } from "node:fs";
import chalk from "chalk";
import { SCRIPT_VERSION, ENV_FILE, COMPOSE_FILE } from "../lib/constants.js";
import { envGet } from "../lib/env.js";
import { runComposeCapture } from "../lib/compose.js";
import { detectComposeCmd } from "../lib/platform.js";
import { dim } from "../lib/ui.js";

interface ComposeImage {
  Service?: string;
  Repository?: string;
  Tag?: string;
  ID?: string;
  Size?: number;
}

export async function cmdVersion(opts?: { runtime?: string }): Promise<void> {
  console.log(`ixora ${SCRIPT_VERSION}`);

  if (!existsSync(ENV_FILE)) return;

  const version = envGet("IXORA_VERSION") || "latest";
  const agentModel =
    envGet("IXORA_AGENT_MODEL") || "anthropic:claude-sonnet-4-6";

  console.log(`  images:  ${version}`);
  console.log(`  model:   ${agentModel}`);

  // Try to show actual running container images with IDs
  if (existsSync(COMPOSE_FILE)) {
    try {
      const composeCmd = await detectComposeCmd(opts?.runtime);
      const output = await runComposeCapture(composeCmd, [
        "images",
        "--format",
        "json",
      ]);

      if (output.trim()) {
        const images = parseComposeImages(output);
        if (images.length > 0) {
          console.log();
          console.log(`  ${chalk.bold("Running containers:")}`);
          for (const img of images) {
            const tag = img.Tag || "unknown";
            const id = img.ID ? dim(` (${img.ID.slice(0, 12)})`) : "";
            const imageStr =
              tag === "latest"
                ? `${img.Repository || ""}:latest${id}`
                : `${img.Repository || ""}:${tag}`;
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

function parseComposeImages(output: string): ComposeImage[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  // docker compose images --format json outputs one JSON object per line
  // (NDJSON), not a JSON array
  try {
    // Try as JSON array first
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    // Try as newline-delimited JSON
    return trimmed
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ComposeImage[];
  }
}
