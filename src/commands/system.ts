import { input, password, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import {
  readSystems,
  systemCount,
  systemIdExists,
  addSystem,
  removeSystem,
  getManagedSystems,
  indexAmongManaged,
  type SystemConfig,
} from "../lib/systems.js";
import { envGet, getApiPortBase, updateEnvKey } from "../lib/env.js";
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

export interface SystemAddOptions {
  /** Skip the kind prompt when set. */
  kind?: "managed" | "external";
  /** Pre-fill the system ID. */
  id?: string;
  /** Pre-fill the display name. */
  name?: string;
  /** External only — pre-fill the URL. */
  url?: string;
  /** External only — pre-fill the AgentOS API key. */
  key?: string;
}

export async function cmdSystemAdd(
  opts: SystemAddOptions = {},
): Promise<void> {
  // First, decide the kind of system being added. External entries are
  // AgentOS URLs ixora doesn't lifecycle-manage (another locally-running
  // AgentOS instance, a teammate's lab, a cloud endpoint).
  const kind =
    opts.kind ??
    (await select<"managed" | "external">({
      message: "What are you adding?",
      choices: [
        {
          name: `Managed       ${dim("Provision a new ixora-managed IBM i stack")}`,
          value: "managed",
        },
        {
          name: `External      ${dim("Register an existing AgentOS URL (local or remote)")}`,
          value: "external",
        },
      ],
      default: "managed",
    }));

  if (kind === "external") {
    await addExternal(opts);
    return;
  }
  await addManaged(opts);
}

async function addManaged(opts: SystemAddOptions): Promise<void> {
  info("Add an IBM i system");
  console.log();

  const id =
    opts.id ??
    (await input({
      message: "System ID (short name, e.g., dev, prod)",
      validate: (value) => {
        const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (!cleaned) return "System ID must contain alphanumeric characters";
        if (systemIdExists(cleaned)) return `System '${cleaned}' already exists`;
        return true;
      },
      transformer: (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
    }));

  const cleanId = id.toLowerCase().replace(/[^a-z0-9-]/g, "");

  const name =
    opts.name ??
    (await input({
      message: "Display name",
      default: cleanId,
    }));

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

  // Optional AgentOS API key. Empty/blank means the system runs unauthenticated
  // (the default for local containers). Stored as SYSTEM_<ID>_AGENTOS_KEY in
  // .env so the agno-mounted commands' resolver can pick it up.
  const agentosKey =
    opts.key ??
    (await password({
      message: "AgentOS API key (leave blank for local/unauthenticated):",
      mask: "*",
    }));

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
    kind: "managed",
    mode,
    host: host.trim(),
    port: port.trim(),
    user: user.trim(),
    pass,
  });

  const trimmedAgentosKey = agentosKey.trim();
  if (trimmedAgentosKey.length > 0) {
    const idUpper = cleanId.toUpperCase().replace(/-/g, "_");
    updateEnvKey(`SYSTEM_${idUpper}_AGENTOS_KEY`, trimmedAgentosKey);
  }

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
    console.log(`  Restart to apply: ${bold("ixora stack restart")}`);
    console.log();
  }
}

async function addExternal(opts: SystemAddOptions): Promise<void> {
  info("Register an external AgentOS endpoint");
  console.log(
    `  ${dim("ixora targets this URL but does not lifecycle-manage it.")}`,
  );
  console.log();

  const id =
    opts.id ??
    (await input({
      message: "System ID (used as `ixora --system <id>`)",
      validate: (value) => {
        const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (!cleaned) return "System ID must contain alphanumeric characters";
        if (systemIdExists(cleaned)) return `System '${cleaned}' already exists`;
        return true;
      },
      transformer: (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
    }));

  const cleanId = id.toLowerCase().replace(/[^a-z0-9-]/g, "");

  const name =
    opts.name ??
    (await input({
      message: "Display name",
      default: cleanId,
    }));

  const url =
    opts.url ??
    (await input({
      message: "AgentOS URL (e.g. http://localhost:8080)",
      validate: validateUrl,
    }));

  if (!validateUrlStrict(url)) {
    die(`Invalid URL: ${url}`);
  }

  const key =
    opts.key ??
    (await password({
      message: "AgentOS API key (optional, leave blank for unauthenticated):",
      mask: "*",
    }));

  addSystem({
    id: cleanId,
    name,
    kind: "external",
    url: url.trim(),
    key: key.trim() || undefined,
  });

  console.log();
  success(`Added external system '${cleanId}' (${url.trim()})`);
  console.log(
    `  ${dim(`Target it with: ${bold(`ixora --system ${cleanId} agents list`)}`)}`,
  );
  console.log(`  Systems: ${systemCount()}`);
  console.log();
}

function validateUrl(value: string): true | string {
  return validateUrlStrict(value)
    ? true
    : "URL must start with http:// or https:// and have a host";
}

function validateUrlStrict(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
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
  console.log(`  Restart to apply: ${bold("ixora stack restart")}`);
}

function validateSystemId(id: string): SystemConfig {
  const sys = readSystems().find((s) => s.id === id);
  if (!sys) die(`System '${id}' not found`);
  return sys;
}

/**
 * Exits non-zero when `sys` is external. Used by per-system lifecycle
 * commands (start/stop/restart) — ixora doesn't lifecycle-manage external
 * endpoints, so the hint redirects users at the runtime tree.
 */
export function assertManaged(sys: SystemConfig): asserts sys is Extract<
  SystemConfig,
  { kind: "managed" }
> {
  if (sys.kind === "external") {
    process.stderr.write(
      `${chalk.red("Error:")} '${sys.id}' is an external AgentOS endpoint.\n`,
    );
    process.stderr.write(`  URL:  ${sys.url}\n`);
    process.stderr.write(
      `ixora does not lifecycle-manage external entries.\n`,
    );
    process.stderr.write(`Start it via its own tooling, then:\n`);
    process.stderr.write(`  ixora --system ${sys.id} agents list\n`);
    process.exit(1);
  }
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
  const sys = validateSystemId(id);
  assertManaged(sys);

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
  const sys = validateSystemId(id);
  assertManaged(sys);

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

/**
 * Show, set, or clear the configured default system.
 *
 * Used by the AgentOS resolver in the multi-system case: when 2+ systems are
 * available and no `--system` is provided, the default is selected if and only
 * if its name appears in the available set. The `--system` flag always wins.
 */
export function cmdSystemDefault(
  id: string | undefined,
  opts: { clear?: boolean } = {},
): void {
  if (opts.clear) {
    if (id) die("Cannot specify both an ID and --clear");
    updateEnvKey("IXORA_DEFAULT_SYSTEM", "");
    success("Default system cleared");
    console.log(
      `  ${dim("With 2+ systems available, you must now pass --system <name>.")}`,
    );
    return;
  }

  if (!id) {
    const current = (envGet("IXORA_DEFAULT_SYSTEM") ?? "").trim();
    console.log();
    if (current.length === 0) {
      console.log(`  ${dim("No default system set.")}`);
      console.log(`  Set with: ${bold("ixora stack system default <id>")}`);
    } else if (!systemIdExists(current)) {
      warn(
        `Default system '${current}' is set but not in ixora-systems.yaml. Re-set or clear it.`,
      );
    } else {
      console.log(`  Default system: ${bold(current)}`);
      console.log(
        `  ${dim("Used when 2+ systems are available and --system is omitted.")}`,
      );
    }
    console.log();
    return;
  }

  if (!systemIdExists(id)) {
    const known = readSystems()
      .map((s) => s.id)
      .join(", ");
    die(`System '${id}' not found. Configured: ${known}`);
  }

  updateEnvKey("IXORA_DEFAULT_SYSTEM", id);
  success(`Default system set to '${id}'`);
  console.log(
    `  ${dim("With 2+ systems available and no --system flag, this system will be used.")}`,
  );
}

export async function cmdSystemRestart(id: string): Promise<void> {
  try {
    requireInstalled();
  } catch (e: unknown) {
    die((e as Error).message);
  }
  const sys = validateSystemId(id);
  assertManaged(sys);

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

function urlForSystem(sys: SystemConfig, systems: SystemConfig[]): string {
  if (sys.kind === "external") return sys.url;
  const idx = indexAmongManaged(systems, sys);
  return `http://localhost:${getApiPortBase() + idx}`;
}

export function cmdSystemList(): void {
  const systems = readSystems();
  const defaultId = (envGet("IXORA_DEFAULT_SYSTEM") ?? "").trim();

  console.log();
  console.log(`  ${chalk.bold("Systems")}`);
  console.log();

  if (systems.length === 0) {
    console.log(
      `  ${dim(`No systems configured. Run: ${bold("ixora stack install")}`)}`,
    );
    console.log();
    return;
  }

  // Header
  console.log(
    `     ${dim("ID".padEnd(14))}${dim("URL".padEnd(40))}${dim("KIND".padEnd(12))}${dim("NOTE")}`,
  );

  for (const sys of systems) {
    const url = urlForSystem(sys, systems);
    const isDefault =
      defaultId.length > 0 ? sys.id === defaultId : sys.id === "default";
    const marker = isDefault ? cyan("*") : cyan(" ");
    const kindLabel =
      sys.kind === "external" ? chalk.magenta("external") : chalk.cyan("managed");
    const note = sys.kind === "external" ? dim("-") : dim(sys.mode);
    console.log(
      `  ${marker}  ${sys.id.padEnd(14)}${url.padEnd(40)}${kindLabel.padEnd(20)}${note}`,
    );
  }

  console.log();

  const managed = getManagedSystems(systems);
  if (managed.length > 1) {
    console.log(
      `  ${dim("Managed systems run on incremental ports (18000, 18001, ...)")}`,
    );
  }
  console.log(
    `  ${dim("Add: ixora stack system add  |  Remove: ixora stack system remove <id>")}`,
  );
  console.log(
    `  ${dim("Target a system: ixora --system <id> agents list")}`,
  );
  console.log();
}
