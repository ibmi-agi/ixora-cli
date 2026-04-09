import { existsSync } from "node:fs";
import { input, password, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  readSystems,
  systemCount,
  systemIdExists,
  totalSystemCount,
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
import { ENV_FILE } from "../lib/constants.js";
import { AGENT_PRESETS, ALL_AGENTS, OPS_AGENTS } from "../lib/constants.js";
import { info, success, die, bold, dim, cyan } from "../lib/ui.js";

export async function cmdSystemAdd(): Promise<void> {
  info("Add an IBM i system");
  console.log();

  const id = await input({
    message: "System ID (short name, e.g., dev, prod)",
    validate: (value) => {
      const cleaned = value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "");
      if (!cleaned) return "System ID must contain alphanumeric characters";
      if (cleaned === "default")
        return "System ID 'default' is reserved for the primary system";
      if (systemIdExists(cleaned))
        return `System '${cleaned}' already exists`;
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
    message: "IBM i hostname",
    validate: (value) => (value.trim() ? true : "Hostname is required"),
  });

  const port = await input({
    message: "IBM i Mapepire port",
    default: "8076",
  });

  const user = await input({
    message: "IBM i username",
    validate: (value) => (value.trim() ? true : "Username is required"),
  });

  const pass = await password({
    message: "IBM i password",
    validate: (value) => (value ? true : "Password is required"),
  });

  const agentChoice = await select({
    message: "Select agents for this system",
    choices: [
      {
        name: "All agents (security, operations, knowledge)",
        value: "all",
      },
      { name: "Security + Operations", value: "security-ops" },
      { name: "Security only", value: "security" },
      {
        name: "Operations only (health, database, work mgmt, config)",
        value: "operations",
      },
      { name: "Knowledge only", value: "knowledge" },
    ],
    default: "all",
  });

  const agents = AGENT_PRESETS[agentChoice as keyof typeof AGENT_PRESETS] as readonly string[];

  addSystem({
    id: cleanId,
    name,
    agents: [...agents],
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
  const primaryHost = envGet("DB2i_HOST");
  if (id === "default") {
    if (!primaryHost) die("No primary system configured");
    return;
  }
  if (!systemIdExists(id)) die(`System '${id}' not found`);
}

function systemServices(id: string): string[] {
  const total = totalSystemCount();
  if (total <= 1 && id === "default") {
    // Single-system mode: services use base names
    return ["ibmi-mcp-server", "api"];
  }
  // Multi-system mode: services are prefixed with system ID
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
  const primaryHost = envGet("DB2i_HOST");

  console.log();
  console.log(`  ${chalk.bold("IBM i Systems")}`);
  console.log();

  if (primaryHost) {
    console.log(
      `  ${cyan("*")}  ${"default".padEnd(12)}  ${primaryHost.padEnd(30)}  ${dim("(primary — from install)")}`,
    );
  }

  const systems = readSystems();
  for (const sys of systems) {
    const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
    const sysHost = envGet(`SYSTEM_${idUpper}_HOST`) || dim("(no host)");
    const agentsStr = sys.agents.join(", ");
    console.log(
      `  ${cyan(" ")}  ${sys.id.padEnd(12)}  ${String(sysHost).padEnd(30)}  ${agentsStr}`,
    );
  }

  if (!primaryHost && systems.length === 0) {
    console.log(`  ${dim(`No systems configured. Run: ${bold("ixora install")}`)}`);
  }

  console.log();

  const total = systems.length + (primaryHost ? 1 : 0);
  if (total > 1) {
    console.log(
      `  ${dim("Multi-system mode: each system runs on its own port (8000, 8001, ...)")}`,
    );
  }
  console.log(
    `  ${dim("Add: ixora system add  |  Remove: ixora system remove <id>")}`,
  );
  console.log();
}
