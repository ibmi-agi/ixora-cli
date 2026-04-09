import chalk from "chalk";
import { envGet } from "../lib/env.js";
import { requireComposeFile, runCompose, runComposeCapture } from "../lib/compose.js";
import { detectComposeCmd, verifyRuntimeRunning, detectPlatform } from "../lib/platform.js";
import { IXORA_DIR } from "../lib/constants.js";
import { die, dim } from "../lib/ui.js";

interface StatusOptions {
  runtime?: string;
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

  // Show running container images so users can verify versions
  try {
    const output = await runComposeCapture(composeCmd, [
      "images",
      "--format",
      "{{.Service}} {{.Repository}}:{{.Tag}}",
    ]);

    if (output.trim()) {
      console.log();
      console.log(`  ${chalk.bold("Images:")}`);
      for (const line of output.trim().split("\n")) {
        const [service, ...imageParts] = line.split(" ");
        const image = imageParts.join(" ");
        if (service && image) {
          console.log(`    ${service.padEnd(22)} ${dim(image)}`);
        }
      }
      console.log();
    }
  } catch {
    // Compose images may not be available if services aren't running
  }
}
