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
import { printRunningBanner } from "../lib/banner.js";
import { resolveStackProfile } from "../lib/profile.js";

interface StatusOptions {
  runtime?: string;
  profile?: string;
}

interface ComposeImage {
  Service?: string;
  Repository?: string;
  Tag?: string;
  ID?: string;
}

interface ComposePs {
  Service?: string;
  State?: string;
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

  const profile = resolveStackProfile(opts);
  const version = envGet("IXORA_VERSION") || "latest";

  let runningServices = new Set<string>();
  try {
    const psJson = await runComposeCapture(
      composeCmd,
      ["ps", "--format", "json"],
      { profile },
    );
    runningServices = getRunningServices(psJson);
  } catch {
    // Compose ps may fail if runtime is unavailable
  }

  // Only the `full` profile includes the UI — never report on it under
  // `mcp`/`cli` even if a stale UI container from a prior `--profile full`
  // run is still up.
  const uiInProfile = profile === "full";
  if (!uiInProfile) {
    runningServices.delete("ui");
  }

  const uiStatus = !uiInProfile
    ? chalk.dim("(not in profile)")
    : runningServices.has("ui")
      ? chalk.green("http://localhost:3000")
      : chalk.yellow("stopped");

  console.log();
  console.log(`  ${chalk.bold("Profile:")}  ${profile}`);
  console.log(`  ${chalk.bold("Version:")}  ${version}`);
  console.log(`  ${chalk.bold("Config:")}   ${IXORA_DIR}`);
  console.log(`  ${chalk.bold("UI:")}       ${uiStatus}`);
  console.log();

  await runCompose(composeCmd, ["ps"], { profile });

  // Show running container images so users can verify actual versions
  try {
    const output = await runComposeCapture(
      composeCmd,
      ["images", "--format", "json"],
      { profile },
    );

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

  if (runningServices.size > 0) {
    printRunningBanner({ runningServices, profile });
  }
}

function getRunningServices(output: string): Set<string> {
  const trimmed = output.trim();
  if (!trimmed) return new Set();

  return new Set(
    parseComposePs(trimmed)
      .filter((s) => s.State === "running" && s.Service)
      .map((s) => s.Service as string),
  );
}

function parseComposePs(output: string): ComposePs[] {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ComposePs[];
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
