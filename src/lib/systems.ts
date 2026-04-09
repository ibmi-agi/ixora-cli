import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { SYSTEMS_CONFIG } from "./constants.js";
import { envGet, updateEnvKey } from "./env.js";
import { ENV_FILE } from "./constants.js";

export interface SystemConfig {
  id: string;
  name: string;
  agents: string[];
}

export function readSystems(
  configFile: string = SYSTEMS_CONFIG,
): SystemConfig[] {
  if (!existsSync(configFile)) return [];

  const content = readFileSync(configFile, "utf-8");
  const systems: SystemConfig[] = [];
  let current: Partial<SystemConfig> | null = null;

  for (const line of content.split("\n")) {
    const idMatch = line.match(/^ {2}- id: (.+)$/);
    if (idMatch) {
      if (current?.id) {
        systems.push({
          id: current.id,
          name: current.name ?? current.id,
          agents: current.agents ?? [],
        });
      }
      current = { id: idMatch[1] };
      continue;
    }

    if (!current) continue;

    const nameMatch = line.match(/name: *'?([^']*)'?/);
    if (nameMatch) {
      current.name = nameMatch[1];
      continue;
    }

    const agentsMatch = line.match(/agents: *\[([^\]]*)\]/);
    if (agentsMatch) {
      current.agents = agentsMatch[1].split(",").map((a) => a.trim()).filter(Boolean);
    }
  }

  // Push the last system
  if (current?.id) {
    systems.push({
      id: current.id,
      name: current.name ?? current.id,
      agents: current.agents ?? [],
    });
  }

  return systems;
}

export function systemCount(configFile: string = SYSTEMS_CONFIG): number {
  return readSystems(configFile).length;
}

export function systemIdExists(
  id: string,
  configFile: string = SYSTEMS_CONFIG,
): boolean {
  return readSystems(configFile).some((s) => s.id === id);
}

export function totalSystemCount(envFile: string = ENV_FILE, configFile: string = SYSTEMS_CONFIG): number {
  const additional = systemCount(configFile);
  const primaryHost = envGet("DB2i_HOST", envFile);
  return primaryHost ? additional + 1 : additional;
}

export function addSystem(
  system: SystemConfig & { host: string; port: string; user: string; pass: string },
  envFile: string = ENV_FILE,
  configFile: string = SYSTEMS_CONFIG,
): void {
  const idUpper = system.id.toUpperCase().replace(/-/g, "_");

  // Store credentials in .env
  updateEnvKey(`SYSTEM_${idUpper}_HOST`, system.host, envFile);
  updateEnvKey(`SYSTEM_${idUpper}_PORT`, system.port, envFile);
  updateEnvKey(`SYSTEM_${idUpper}_USER`, system.user, envFile);
  updateEnvKey(`SYSTEM_${idUpper}_PASS`, system.pass, envFile);

  const escapedName = system.name.replace(/'/g, "'\\''");
  const agentsList = system.agents.join(", ");
  const entry = `  - id: ${system.id}\n    name: '${escapedName}'\n    agents: [${agentsList}]\n`;

  mkdirSync(dirname(configFile), { recursive: true });

  if (!existsSync(configFile) || systemCount(configFile) === 0) {
    const content = `# yaml-language-server: $schema=
# Ixora Systems Configuration
# Manage with: ixora-cli system add|remove|list
# Credentials stored in .env (SYSTEM_<ID>_USER, SYSTEM_<ID>_PASS)
systems:
${entry}`;
    writeFileSync(configFile, content, "utf-8");
  } else {
    const existing = readFileSync(configFile, "utf-8");
    writeFileSync(configFile, `${existing}${entry}`, "utf-8");
  }

  chmodSync(configFile, 0o600);
}

export function removeSystem(
  id: string,
  envFile: string = ENV_FILE,
  configFile: string = SYSTEMS_CONFIG,
): void {
  if (!existsSync(configFile)) {
    throw new Error("No systems configured");
  }

  if (!systemIdExists(id, configFile)) {
    throw new Error(`System '${id}' not found`);
  }

  const content = readFileSync(configFile, "utf-8");
  const lines = content.split("\n");
  const output: string[] = [];
  let skip = false;

  for (const line of lines) {
    if (line === `  - id: ${id}`) {
      skip = true;
      continue;
    }
    if (line.match(/^ {2}- id: /)) {
      skip = false;
    }
    if (!skip) {
      output.push(line);
    }
  }

  writeFileSync(configFile, output.join("\n"), "utf-8");
  chmodSync(configFile, 0o600);

  // Remove credentials from .env
  if (existsSync(envFile)) {
    const idUpper = id.toUpperCase().replace(/-/g, "_");
    const envContent = readFileSync(envFile, "utf-8");
    const filtered = envContent
      .split("\n")
      .filter((line) => !line.startsWith(`SYSTEM_${idUpper}_`))
      .join("\n");
    writeFileSync(envFile, filtered, "utf-8");
    chmodSync(envFile, 0o600);
  }
}
