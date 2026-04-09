import chalk from "chalk";
import { envGet } from "../lib/env.js";
import {
  requireComposeFile,
  runCompose,
  runComposeCapture,
} from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { IXORA_DIR } from "../lib/constants.js";
import { die, dim } from "../lib/ui.js";

interface StatusOptions {
  runtime?: string;
}

interface ComposeImage {
  Service?: string;
  Repository?: string;
  Tag?: string;
  ID?: string;
}

export async function cmdStatus(opts: StatusOptions): Promise<void> {
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

  const profile = envGet("IXORA_PROFILE") || "full";
  const version = envGet("IXORA_VERSION") || "latest";

  console.log();
  console.log(`  ${chalk.bold("Profile:")}  ${profile}`);
  console.log(`  ${chalk.bold("Version:")}  ${version}`);
  console.log(`  ${chalk.bold("Config:")}   ${IXORA_DIR}`);
  console.log();

  await runCompose(composeCmd, ["ps"]);

  // Show running container images so users can verify actual versions
  try {
    const output = await runComposeCapture(composeCmd, [
      "images",
      "--format",
      "json",
    ]);

    if (output.trim()) {
      const images = parseComposeImages(output);
      if (images.length > 0) {
        console.log();
        console.log(`  ${chalk.bold("Images:")}`);
        for (const img of images) {
          const tag = img.Tag || "unknown";
          const id = img.ID ? ` (${img.ID.slice(0, 12)})` : "";
          const tagDisplay = tag === "latest" ? `${tag}${dim(id)}` : tag;
          console.log(`    ${dim(`${img.Repository || ""}:`)}${tagDisplay}`);
        }
        console.log();
      }
    }
  } catch {
    // Compose images not available if services aren't running
  }
}

function parseComposeImages(output: string): ComposeImage[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
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
