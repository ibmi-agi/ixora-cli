import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { execa } from "execa";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { envGet, getApiPortBase, updateEnvKey } from "../lib/env.js";
import {
  DEFAULT_DB_ISOLATION,
  ENV_FILE,
  SYSTEMS_CONFIG,
  type DeploymentMode,
} from "../lib/constants.js";
import { readSystems } from "../lib/systems.js";
import { ensureManifest } from "../lib/manifest.js";
import { promptComponentPicker } from "../lib/picker.js";
import {
  deleteUserProfile,
  profileFromManifest,
  readUserProfile,
  userProfilePath,
  validateProfileAgainstManifest,
  writeUserProfile,
} from "../lib/profiles.js";
import {
  die,
  success,
  info,
  maskValue,
  isSensitiveKey,
  bold,
  dim,
  cyan,
  section,
  warn,
} from "../lib/ui.js";

export function cmdConfigShow(): void {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  console.log();
  console.log(`  ${chalk.bold("Configuration")}  ${ENV_FILE}`);
  console.log();

  // Model
  section("Model");
  const agentModel =
    envGet("IXORA_AGENT_MODEL") || "anthropic:claude-sonnet-4-6";
  const teamModel = envGet("IXORA_TEAM_MODEL") || "anthropic:claude-haiku-4-5";
  const providerKind = envGet("IXORA_MODEL_PROVIDER");
  const anthKey = envGet("ANTHROPIC_API_KEY");
  const oaiKey = envGet("OPENAI_API_KEY");
  const googKey = envGet("GOOGLE_API_KEY");
  const ollamaHost = envGet("OLLAMA_HOST");
  const openaiBaseUrl = envGet("IXORA_OPENAI_BASE_URL");

  console.log(`  ${cyan("IXORA_AGENT_MODEL")}      ${agentModel}`);
  console.log(`  ${cyan("IXORA_TEAM_MODEL")}       ${teamModel}`);
  if (providerKind)
    console.log(`  ${cyan("IXORA_MODEL_PROVIDER")}   ${providerKind}`);
  if (openaiBaseUrl)
    console.log(`  ${cyan("IXORA_OPENAI_BASE_URL")}  ${openaiBaseUrl}`);
  if (anthKey)
    console.log(`  ${cyan("ANTHROPIC_API_KEY")}      ${maskValue(anthKey)}`);
  if (oaiKey)
    console.log(`  ${cyan("OPENAI_API_KEY")}         ${maskValue(oaiKey)}`);
  if (googKey)
    console.log(`  ${cyan("GOOGLE_API_KEY")}         ${maskValue(googKey)}`);
  if (ollamaHost)
    console.log(`  ${cyan("OLLAMA_HOST")}            ${ollamaHost}`);
  console.log();

  // IBM i Systems — one entry per configured system from ixora-systems.yaml
  section("IBM i Systems");
  const systems = readSystems();
  if (systems.length === 0) {
    console.log(
      `  ${dim("(no systems configured — run `ixora system add`)")}`,
    );
  } else {
    for (const sys of systems) {
      const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
      const host = envGet(`SYSTEM_${idUpper}_HOST`);
      const user = envGet(`SYSTEM_${idUpper}_USER`);
      const pass = envGet(`SYSTEM_${idUpper}_PASS`);
      const port = envGet(`SYSTEM_${idUpper}_PORT`) || "8076";

      console.log(`  ${bold(sys.id)}  ${dim(sys.name)}`);
      console.log(`    ${cyan("host")}      ${host || dim("(not set)")}`);
      console.log(`    ${cyan("user")}      ${user || dim("(not set)")}`);
      console.log(`    ${cyan("password")}  ${maskValue(pass)}`);
      console.log(`    ${cyan("port")}      ${port}`);
      console.log(`    ${cyan("mode")}      ${sys.mode}`);
      console.log();
    }
  }

  // Deployment
  section("Deployment");
  const stackProfile = envGet("IXORA_PROFILE") || "full";
  const version = envGet("IXORA_VERSION") || "latest";
  const apiPort = getApiPortBase();
  const cliModeRaw = envGet("IXORA_CLI_MODE").toLowerCase();
  const cliModeEnv =
    cliModeRaw === "true" || cliModeRaw === "1" || cliModeRaw === "yes";
  const cliMode = stackProfile === "cli" || cliModeEnv;
  const cliModeNote = !cliMode
    ? "false"
    : cliModeEnv
      ? `true  ${dim("# ibmi CLI direct — MCP server not started")}`
      : `true  ${dim("# implied by --profile cli")}`;
  const dbIsolationMode =
    envGet("IXORA_DB_ISOLATION").trim().toLowerCase() || DEFAULT_DB_ISOLATION;
  const dbIsolationNote =
    dbIsolationMode === "shared"
      ? `shared  ${dim("# all systems share the one `ai` database")}`
      : `per-system  ${dim("# each IBM i system gets its own Postgres database")}`;

  console.log(
    `  ${cyan("IXORA_PROFILE")}        ${stackProfile}  ${dim("# stack shape (full|mcp|cli)")}`,
  );
  console.log(`  ${cyan("IXORA_VERSION")}        ${version}`);
  console.log(`  ${cyan("IXORA_API_PORT")}       ${apiPort}`);
  console.log(`  ${cyan("IXORA_CLI_MODE")}       ${cliModeNote}`);
  console.log(`  ${cyan("IXORA_DB_ISOLATION")}   ${dbIsolationNote}`);
  console.log();

  // Extra keys — filter out anything already surfaced above, plus the
  // per-system SYSTEM_<ID>_* credentials which are rendered under "IBM i
  // Systems". DB2i_*/DB2_PORT are intentionally NOT in this set so any
  // stale lines from a pre-migration install surface under "Other" as a
  // one-time signal they're dead weight.
  const knownKeys = new Set([
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "OLLAMA_HOST",
    "IXORA_OPENAI_BASE_URL",
    "IXORA_MODEL_PROVIDER",
    "IXORA_PROFILE",
    "IXORA_VERSION",
    "IXORA_PREVIOUS_VERSION",
    "IXORA_AGENT_MODEL",
    "IXORA_TEAM_MODEL",
    "IXORA_API_PORT",
    "IXORA_CLI_MODE",
    "IXORA_DB_ISOLATION",
  ]);

  const content = readFileSync(ENV_FILE, "utf-8");
  const extraLines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    const key = trimmed.split("=")[0];
    if (knownKeys.has(key)) return false;
    // Per-system credentials are displayed under "IBM i Systems" above.
    if (/^SYSTEM_[A-Z0-9_]+_(HOST|USER|PASS|PORT)$/.test(key)) return false;
    return true;
  });

  if (extraLines.length > 0) {
    section("Other");
    for (const line of extraLines) {
      const [key, ...rest] = line.split("=");
      let val = rest.join("=").replace(/^['"]|['"]$/g, "");
      if (isSensitiveKey(key)) {
        console.log(`  ${cyan(key)}  ${maskValue(val)}`);
      } else {
        console.log(`  ${cyan(key)}  ${val}`);
      }
    }
    console.log();
  }

  console.log(`  ${dim("Edit with: ixora config edit")}`);
  console.log(`  ${dim("Set a value: ixora config set KEY VALUE")}`);
  console.log();
}

export function cmdConfigSet(key: string, value: string): void {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  updateEnvKey(key, value);
  success(`Set ${key}`);
  console.log(`  Restart to apply: ${bold("ixora restart")}`);
}

export async function cmdConfigEdit(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  const editor = process.env["EDITOR"] ?? process.env["VISUAL"] ?? "";

  let editorCmd = editor;
  if (!editorCmd) {
    // Try common editors
    for (const candidate of ["vim", "vi", "nano"]) {
      try {
        await execa("which", [candidate]);
        editorCmd = candidate;
        break;
      } catch {
        continue;
      }
    }
  }

  if (!editorCmd) {
    die("No editor found. Set $EDITOR or install vim/nano.");
  }

  info(`Opening ${editorCmd}...`);
  await execa(editorCmd, [ENV_FILE], { stdio: "inherit" });

  console.log();
  success("Config saved");
  console.log(`  Restart to apply: ${bold("ixora restart")}`);
}

// ---------------------------------------------------------------------------
// System-scoped config (mode + custom component picker)
// ---------------------------------------------------------------------------

function findSystem(systemId: string): {
  id: string;
  name: string;
  mode: DeploymentMode;
} {
  const sys = readSystems().find((s) => s.id === systemId);
  if (!sys) die(`System '${systemId}' not found`);
  // die() throws — narrowing helper so TS knows we've got a SystemConfig here.
  return sys as { id: string; name: string; mode: DeploymentMode };
}

/**
 * `ixora config show <system>` — print mode + resolved component list.
 * For Custom mode we also validate the YAML against the cached manifest
 * so typos surface here instead of at the next container restart.
 */
export async function cmdSystemConfigShow(systemId: string): Promise<void> {
  const sys = findSystem(systemId);
  console.log();
  console.log(`  ${bold(sys.id)}  ${dim(sys.name)}`);
  console.log(`    ${cyan("mode")}      ${sys.mode}`);

  if (sys.mode === "full") {
    console.log(
      `    ${cyan("source")}    ${dim("app/config/deployments/full.yaml (in image)")}`,
    );
    console.log();
    return;
  }

  const path = userProfilePath(systemId);
  const profile = readUserProfile(systemId);
  console.log(`    ${cyan("source")}    ${dim(path)}`);
  if (!profile) {
    warn(
      `Mode is 'custom' but no profile YAML found. Run: ixora config edit ${systemId}`,
    );
    return;
  }

  for (const kind of ["agents", "teams", "workflows", "knowledge"] as const) {
    const ids = profile[kind];
    if (ids.length === 0) continue;
    console.log(`    ${cyan(kind)}`);
    for (const id of ids) console.log(`      - ${id}`);
  }

  // Client-side mirror of app/deployment.py's validation.
  const version = envGet("IXORA_VERSION") || "latest";
  try {
    const manifest = await ensureManifest(
      `ghcr.io/ibmi-agi/ixora-api:${version}`,
    );
    const problems = validateProfileAgainstManifest(profile, manifest);
    if (problems.length > 0) {
      console.log();
      for (const p of problems) {
        warn(
          `Unknown ${p.kind} in profile: ${p.missing.join(", ")} — ` +
            `removed in this image. Edit with: ixora config edit ${systemId}`,
        );
      }
    }
  } catch {
    // Cache miss + offline image — just skip validation rather than die.
  }
  console.log();
}

/**
 * `ixora config edit <system>` — interactive: switch mode, or re-open
 * the Custom picker (pre-checked from the existing YAML).
 */
export async function cmdSystemConfigEdit(systemId: string): Promise<void> {
  const sys = findSystem(systemId);

  const choices: { name: string; value: string }[] = [
    {
      name:
        sys.mode === "full"
          ? `Stay on Full   ${dim("(no change)")}`
          : `Switch to Full ${dim("(load every component the image declares)")}`,
      value: "full",
    },
    {
      name:
        sys.mode === "custom"
          ? `Edit Custom    ${dim("(re-open the component picker)")}`
          : `Switch to Custom ${dim("(pick which components to enable)")}`,
      value: "custom",
    },
  ];

  const choice = await select({
    message: `Configure system '${systemId}' (currently: ${sys.mode})`,
    choices,
    default: sys.mode,
  });

  if (choice === "full") {
    if (sys.mode === "custom") deleteUserProfile(systemId);
    setSystemMode(systemId, "full");
    success(
      `System '${systemId}' set to Full mode. Restart to apply: ${bold("ixora restart")}`,
    );
    return;
  }

  // Custom — fetch manifest, pre-check from existing profile (or all-on).
  const version = envGet("IXORA_VERSION") || "latest";
  info("Fetching component manifest from image...");
  const manifest = await ensureManifest(
    `ghcr.io/ibmi-agi/ixora-api:${version}`,
  );
  const seed = readUserProfile(systemId) ?? profileFromManifest(manifest);
  const picker = await promptComponentPicker(manifest, seed);
  if (!picker.selected) {
    warn("No components selected — leaving mode unchanged.");
    return;
  }
  writeUserProfile(systemId, picker.profile);
  setSystemMode(systemId, "custom");
  success(
    `System '${systemId}' set to Custom mode. Restart to apply: ${bold("ixora restart")}`,
  );
}

/**
 * `ixora config reset <system>` — drop the custom YAML (kept as .bak),
 * revert mode to full. Cheap regret insurance.
 */
export function cmdSystemConfigReset(systemId: string): void {
  const sys = findSystem(systemId);
  if (sys.mode === "custom") {
    deleteUserProfile(systemId);
    success(
      `Backed up custom profile to ${userProfilePath(systemId)}.bak`,
    );
  }
  setSystemMode(systemId, "full");
  success(
    `System '${systemId}' reset to Full mode. Restart to apply: ${bold("ixora restart")}`,
  );
}

/**
 * Mutate the `mode:` line for a system in ixora-systems.yaml without
 * a YAML library. Mirrors the line-oriented approach used elsewhere in
 * this CLI (see systems.ts).
 */
function setSystemMode(systemId: string, mode: DeploymentMode): void {
  if (!existsSync(SYSTEMS_CONFIG)) die(`No systems config at ${SYSTEMS_CONFIG}`);
  const lines = readFileSync(SYSTEMS_CONFIG, "utf-8").split("\n");
  const out: string[] = [];
  let inTarget = false;
  let wroteMode = false;
  for (const line of lines) {
    const idMatch = line.match(/^ {2}- id: (.+)$/);
    if (idMatch) {
      // Leaving a system block without a mode line: synthesize one.
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
  writeFileSync(SYSTEMS_CONFIG, out.join("\n"), "utf-8");
  chmodSync(SYSTEMS_CONFIG, 0o600);
}
