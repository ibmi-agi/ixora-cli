import { existsSync } from "node:fs";
import { input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import {
  readSystems,
  systemCount,
  systemIdExists,
  addSystem,
  removeSystem,
} from "../lib/systems.js";
import { envGet } from "../lib/env.js";
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
  console.log(`  Restart to apply: ${bold("ixora restart")}`);
  console.log();
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
