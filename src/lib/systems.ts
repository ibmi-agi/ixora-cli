import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { SYSTEMS_CONFIG, type DeploymentMode } from "./constants.js";
import { updateEnvKey } from "./env.js";
import { ENV_FILE } from "./constants.js";

export type SystemKind = "managed" | "external";

/**
 * A `managed` system is an ixora-provisioned docker compose stack — the
 * runtime targets `http://localhost:<port>` where the port is computed from
 * the entry's index among the managed systems.
 */
export interface ManagedSystemConfig {
  id: string;
  name: string;
  kind: "managed";
  /** "full" loads every component; "custom" reads ~/.ixora/profiles/<id>.yaml. */
  mode: DeploymentMode;
}

/**
 * An `external` system is any AgentOS-compatible endpoint ixora does NOT
 * lifecycle-manage — typically another locally-running AgentOS instance on
 * `http://localhost:<other-port>`, but the URL can be remote.
 */
export interface ExternalSystemConfig {
  id: string;
  name: string;
  kind: "external";
  url: string;
}

export type SystemConfig = ManagedSystemConfig | ExternalSystemConfig;

export function readSystems(
  configFile: string = SYSTEMS_CONFIG,
): SystemConfig[] {
  if (!existsSync(configFile)) return [];

  const content = readFileSync(configFile, "utf-8");
  const systems: SystemConfig[] = [];
  let current: {
    id?: string;
    name?: string;
    kind?: SystemKind;
    mode?: DeploymentMode;
    url?: string;
  } | null = null;

  const commit = (): void => {
    if (!current?.id) return;
    const kind: SystemKind = current.kind ?? "managed";
    if (kind === "external") {
      // Skip malformed external entries (no URL) rather than crashing.
      if (!current.url) return;
      systems.push({
        id: current.id,
        name: current.name ?? current.id,
        kind: "external",
        url: current.url,
      });
    } else {
      systems.push({
        id: current.id,
        name: current.name ?? current.id,
        kind: "managed",
        mode: current.mode ?? "full",
      });
    }
  };

  for (const line of content.split("\n")) {
    const idMatch = line.match(/^ {2}- id: (.+)$/);
    if (idMatch) {
      commit();
      current = { id: idMatch[1] };
      continue;
    }

    if (!current) continue;

    const nameMatch = line.match(/^ {4}name: *'?([^']*)'?/);
    if (nameMatch) {
      current.name = nameMatch[1];
      continue;
    }

    const kindMatch = line.match(/^ {4}kind: *'?(managed|external)'?/);
    if (kindMatch) {
      current.kind = kindMatch[1] as SystemKind;
      continue;
    }

    const modeMatch = line.match(/^ {4}mode: *'?([^']*)'?/);
    if (modeMatch) {
      const value = modeMatch[1];
      current.mode = value === "custom" ? "custom" : "full";
      continue;
    }

    const urlMatch = line.match(/^ {4}url: *'?([^']*)'?/);
    if (urlMatch) {
      current.url = urlMatch[1];
      continue;
    }
  }

  commit();

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

export function totalSystemCount(
  envFile: string = ENV_FILE,
  configFile: string = SYSTEMS_CONFIG,
): number {
  return readSystems(configFile).length;
}

/**
 * Filter to ixora-managed entries only. Used by the resolver and the
 * compose-file generator so external entries don't consume port slots.
 */
export function getManagedSystems(
  systems: SystemConfig[],
): ManagedSystemConfig[] {
  return systems.filter(
    (s): s is ManagedSystemConfig => s.kind === "managed",
  );
}

/**
 * Position of `target` in the managed-only subset. Returns -1 if `target`
 * is not a managed system. The resolver and `multi-compose.ts` both call
 * this so external entries can be inserted anywhere in the YAML without
 * shifting managed port assignments.
 */
export function indexAmongManaged(
  systems: SystemConfig[],
  target: SystemConfig,
): number {
  if (target.kind !== "managed") return -1;
  return getManagedSystems(systems).findIndex((s) => s.id === target.id);
}

export type AddManagedSystemInput = {
  id: string;
  name: string;
  kind?: "managed";
  mode: DeploymentMode;
  host: string;
  port: string;
  user: string;
  pass: string;
};

export type AddExternalSystemInput = {
  id: string;
  name: string;
  kind: "external";
  url: string;
  key?: string;
};

export type AddSystemInput = AddManagedSystemInput | AddExternalSystemInput;

export function addSystem(
  system: AddSystemInput,
  envFile: string = ENV_FILE,
  configFile: string = SYSTEMS_CONFIG,
): void {
  const idUpper = system.id.toUpperCase().replace(/-/g, "_");
  const escapedName = system.name.replace(/'/g, "'\\''");

  let entry: string;
  if (system.kind === "external") {
    entry = `  - id: ${system.id}\n    name: '${escapedName}'\n    kind: external\n    url: '${system.url.replace(/'/g, "'\\''")}'\n`;
    if (system.key && system.key.length > 0) {
      updateEnvKey(`SYSTEM_${idUpper}_AGENTOS_KEY`, system.key, envFile);
    }
  } else {
    // Managed (default). Store IBM i credentials in .env.
    updateEnvKey(`SYSTEM_${idUpper}_HOST`, system.host, envFile);
    updateEnvKey(`SYSTEM_${idUpper}_PORT`, system.port, envFile);
    updateEnvKey(`SYSTEM_${idUpper}_USER`, system.user, envFile);
    updateEnvKey(`SYSTEM_${idUpper}_PASS`, system.pass, envFile);

    const mode = system.mode === "custom" ? "custom" : "full";
    entry = `  - id: ${system.id}\n    name: '${escapedName}'\n    kind: managed\n    mode: ${mode}\n`;
  }

  mkdirSync(dirname(configFile), { recursive: true });

  if (!existsSync(configFile) || systemCount(configFile) === 0) {
    const content = `# yaml-language-server: $schema=
# Ixora Systems Configuration
# Manage with: ixora stack system add|remove|list
# Credentials stored in .env (SYSTEM_<ID>_USER, SYSTEM_<ID>_PASS, SYSTEM_<ID>_AGENTOS_KEY)
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

  // Remove credentials from .env (works for both managed and external —
  // external entries only have SYSTEM_<ID>_AGENTOS_KEY, which this filter
  // covers along with the managed HOST/PORT/USER/PASS quad).
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

/**
 * Update the `mode:` line for a single system in ixora-systems.yaml without
 * pulling in a YAML library. Mirrors the line-oriented approach used by
 * the rest of this file. Synthesises a missing `mode:` line for older
 * configs that don't yet carry one.
 *
 * Only applies to managed systems; external systems have no mode.
 */
export function setSystemMode(
  systemId: string,
  mode: DeploymentMode,
  configFile: string = SYSTEMS_CONFIG,
): void {
  if (!existsSync(configFile)) {
    throw new Error(`No systems config at ${configFile}`);
  }
  const lines = readFileSync(configFile, "utf-8").split("\n");
  const out: string[] = [];
  let inTarget = false;
  let wroteMode = false;
  for (const line of lines) {
    const idMatch = line.match(/^ {2}- id: (.+)$/);
    if (idMatch) {
      // Leaving a system block without writing a mode line — synthesise one.
      if (inTarget && !wroteMode) out.push(`    mode: ${mode}`);
      inTarget = idMatch[1] === systemId;
      wroteMode = false;
      out.push(line);
      continue;
    }
    if (inTarget && /^ {4}mode: /.test(line)) {
      out.push(`    mode: ${mode}`);
      wroteMode = true;
      continue;
    }
    out.push(line);
  }
  if (inTarget && !wroteMode) out.push(`    mode: ${mode}`);
  writeFileSync(configFile, out.join("\n"), "utf-8");
  chmodSync(configFile, 0o600);
}
