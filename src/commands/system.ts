import { input, password, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  readSystems,
  systemCount,
  systemIdExists,
  addSystem,
  removeSystem,
} from "../lib/systems.js";
import { envGet } from "../lib/env.js";
import {
  requireInstalled,
  writeComposeFile,
  runCompose,
} from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { waitForHealthy } from "../lib/health.js";
import { ENV_FILE, type DeploymentMode } from "../lib/constants.js";
import { info, success, die, bold, dim, cyan, warn } from "../lib/ui.js";
import { ensureManifest } from "../lib/manifest.js";
import { promptComponentPicker } from "../lib/picker.js";
import { profileFromManifest, writeUserProfile } from "../lib/profiles.js";

export async function cmdSystemAdd(): Promise<void> {
  info("Add an IBM i system");
  console.log();

  const id = await input({
    message: "System ID (short name, e.g., dev, prod)",
    validate: (value) => {
      const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!cleaned) return "System ID must contain alphanumeric characters";
      if (systemIdExists(cleaned)) return `System '${cleaned}' already exists`;
      return true;
    },
    transformer: (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
  });

  const cleanId = id.toLowerCase().replace(/[^a-z0-9-]/g, "");

  const name = await input({
    message: "Display name",
    default: cleanId,
  });

  const host = await input({
    message: "IBM i hostname:",
    validate: (value) => (value.trim() ? true : "IBM i hostname is required"),
  });

  const user = await input({
    message: "IBM i username:",
    validate: (value) => (value.trim() ? true : "IBM i username is required"),
  });

  const pass = await password({
    message: "IBM i password:",
    validate: (value) => (value ? true : "Password is required"),
  });

  const port = await input({
    message: "IBM i port:",
    default: "8076",
    validate: (value) => {
      const n = parseInt(value.trim(), 10);
      if (isNaN(n) || n < 1 || n > 65535) return "Enter a valid port number";
      return true;
    },
  });

  let mode = await select<DeploymentMode>({
    message: "How should this system be deployed?",
    choices: [
      {
        name: `Full           ${dim("Every component the image declares")}`,
        value: "full",
      },
      {
        name: `Custom         ${dim("Pick which components to enable")}`,
        value: "custom",
      },
    ],
    default: "full",
  });

  if (mode === "custom") {
    const version = envGet("IXORA_VERSION") || "latest";
    info("Fetching component manifest from image...");
    const manifest = await ensureManifest(
      `ghcr.io/ibmi-agi/ixora-api:${version}`,
    );
    const picker = await promptComponentPicker(
      manifest,
      profileFromManifest(manifest),
    );
    if (!picker.selected) {
      warn("No components selected — falling back to Full mode.");
      mode = "full";
    } else {
      writeUserProfile(cleanId, picker.profile);
      success(`Wrote ~/.ixora/profiles/${cleanId}.yaml`);
    }
  }

  addSystem({
    id: cleanId,
    name,
    mode,
    host: host.trim(),
    port: port.trim(),
    user: user.trim(),
    pass,
  });

  console.log();
  success(`Added system '${cleanId}' (${host.trim()})`);
  console.log(`  Credentials stored in ${dim(ENV_FILE)}`);
  console.log(`  Systems: ${systemCount()}`);
  console.log();

  const shouldRestart = await confirm({
    message: "Restart services now to apply?",
    default: true,
  });

  if (shouldRestart) {
    const { cmdRestart } = await import("./restart.js");
    await cmdRestart({});
  } else {
    console.log(`  Restart to apply: ${bold("ixora restart")}`);
    console.log();
  }
}

export function cmdSystemRemove(id: string): void {
  try {
    removeSystem(id);
  } catch (e: unknown) {
    die((e as Error).message);
  }

  success(`Removed system '${id}'`);
  console.log(`  Systems: ${systemCount()}`);
  console.log(`  Restart to apply: ${bold("ixora restart")}`);
}

function validateSystemId(id: string): void {
  if (!systemIdExists(id)) die(`System '${id}' not found`);
}

function systemServices(id: string): string[] {
  return [`mcp-${id}`, `api-${id}`];
}

export async function cmdSystemStart(id: string): Promise<void> {
  try {
    requireInstalled();
  } catch (e: unknown) {
    die((e as Error).message);
  }
  validateSystemId(id);

  let composeCmd;
  try {
    composeCmd = await detectComposeCmd();
    await verifyRuntimeRunning(composeCmd);
  } catch (e: unknown) {
    die((e as Error).message);
  }
  detectPlatform();

  writeComposeFile();

  const services = systemServices(id);
  info(`Starting system '${id}' (${services.join(", ")})...`);
  await runCompose(composeCmd, ["up", "-d", ...services]);
  await waitForHealthy(composeCmd);
  success(`System '${id}' started`);
}

export async function cmdSystemStop(id: string): Promise<void> {
  try {
    requireInstalled();
  } catch (e: unknown) {
    die((e as Error).message);
  }
  validateSystemId(id);

  let composeCmd;
  try {
    composeCmd = await detectComposeCmd();
    await verifyRuntimeRunning(composeCmd);
  } catch (e: unknown) {
    die((e as Error).message);
  }
  detectPlatform();

  writeComposeFile();

  const services = systemServices(id);
  info(`Stopping system '${id}' (${services.join(", ")})...`);
  await runCompose(composeCmd, ["stop", ...services]);
  success(`System '${id}' stopped`);
}

export async function cmdSystemRestart(id: string): Promise<void> {
  try {
    requireInstalled();
  } catch (e: unknown) {
    die((e as Error).message);
  }
  validateSystemId(id);

  let composeCmd;
  try {
    composeCmd = await detectComposeCmd();
    await verifyRuntimeRunning(composeCmd);
  } catch (e: unknown) {
    die((e as Error).message);
  }
  detectPlatform();

  writeComposeFile();

  const services = systemServices(id);
  info(`Restarting system '${id}' (${services.join(", ")})...`);
  await runCompose(composeCmd, ["up", "-d", "--force-recreate", ...services]);
  await waitForHealthy(composeCmd);
  success(`System '${id}' restarted`);
}

export function cmdSystemList(): void {
  const systems = readSystems();

  console.log();
  console.log(`  ${chalk.bold("IBM i Systems")}`);
  console.log();

  if (systems.length === 0) {
    console.log(
      `  ${dim(`No systems configured. Run: ${bold("ixora install")}`)}`,
    );
  }

  for (const sys of systems) {
    const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
    const sysHost = envGet(`SYSTEM_${idUpper}_HOST`) || dim("(no host)");
    const marker = sys.id === "default" ? cyan("*") : cyan(" ");
    console.log(
      `  ${marker}  ${sys.id.padEnd(12)}  ${String(sysHost).padEnd(30)}  ${dim(sys.mode)}`,
    );
  }

  console.log();

  if (systems.length > 1) {
    console.log(
      `  ${dim("Multi-system mode: each system runs on its own port (18000, 18001, ...)")}`,
    );
  }
  console.log(
    `  ${dim("Add: ixora system add  |  Remove: ixora system remove <id>")}`,
  );
  console.log();
}
