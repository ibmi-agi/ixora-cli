import { existsSync } from "node:fs";
import { input, password, select } from "@inquirer/prompts";
import { envGet, writeEnvFile, type EnvConfig } from "../lib/env.js";
import { writeComposeFile, runCompose } from "../lib/compose.js";
import { addSystem, systemIdExists } from "../lib/systems.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { waitForHealthy } from "../lib/health.js";
import {
  SCRIPT_VERSION,
  IXORA_DIR,
  AGENT_PROFILES,
  type AgentProfileName,
  VALID_AGENT_PROFILES,
} from "../lib/constants.js";
import { info, success, warn, die, bold, dim } from "../lib/ui.js";
import { printRunningBanner } from "../lib/banner.js";
import { fetchImageTags, normalizeVersion } from "../lib/registry.js";
import { promptModelProvider } from "../lib/models.js";

interface InstallOptions {
  runtime?: string;
  imageVersion?: string;
  profile?: string;
  agentProfile?: string;
  pull?: boolean;
}

async function promptIbmiConnection(): Promise<{
  host: string;
  user: string;
  pass: string;
  port: string;
}> {
  info("IBM i Connection");
  console.log();

  const curHost = envGet("SYSTEM_DEFAULT_HOST");
  const curUser = envGet("SYSTEM_DEFAULT_USER");
  const curPass = envGet("SYSTEM_DEFAULT_PASS");
  const curPort = envGet("SYSTEM_DEFAULT_PORT");

  const host = await input({
    message: "IBM i hostname:",
    default: curHost || undefined,
    validate: (value) => (value.trim() ? true : "IBM i hostname is required"),
  });

  const user = await input({
    message: "IBM i username:",
    default: curUser || undefined,
    validate: (value) => (value.trim() ? true : "IBM i username is required"),
  });

  const pass = await password({
    message: "IBM i password:",
    validate: (value) => {
      if (!value && !curPass) return "IBM i password is required";
      return true;
    },
  });

  const port = await input({
    message: "IBM i port:",
    default: curPort || "8076",
    validate: (value) => {
      const n = parseInt(value.trim(), 10);
      if (isNaN(n) || n < 1 || n > 65535) return "Enter a valid port number";
      return true;
    },
  });

  return {
    host: host.trim(),
    user: user.trim(),
    pass: pass || curPass,
    port: port.trim(),
  };
}

async function promptAgentProfile(): Promise<AgentProfileName> {
  const profile = await select<AgentProfileName>({
    message: "Select an agent profile",
    choices: VALID_AGENT_PROFILES.map((p) => ({
      name: `${AGENT_PROFILES[p].name.padEnd(14)} ${dim(AGENT_PROFILES[p].description)}`,
      value: p,
    })),
    default: "full" as AgentProfileName,
  });

  success(`Agent profile: ${profile}`);
  return profile;
}

export async function cmdInstall(opts: InstallOptions): Promise<void> {
  info(`Installing ixora (v${SCRIPT_VERSION})`);
  console.log();

  let composeCmd;
  try {
    composeCmd = await detectComposeCmd(opts.runtime);
    await verifyRuntimeRunning(composeCmd);
  } catch (e: unknown) {
    die((e as Error).message);
  }
  detectPlatform();
  info(`Using: ${composeCmd}`);
  console.log();

  // Check for existing installation
  if (existsSync(IXORA_DIR)) {
    warn(`Existing installation found at ${IXORA_DIR}`);
    const action = await select({
      message: "What would you like to do?",
      choices: [
        {
          name: "Reconfigure — re-run setup prompts (overwrites current config)",
          value: "reconfigure",
        },
        { name: "Cancel — keep existing installation", value: "cancel" },
      ],
      default: "reconfigure",
    });

    if (action === "cancel") {
      info("Cancelled");
      return;
    }
    info("Reconfiguring...");
    console.log();
  }

  const {
    agentModel,
    teamModel,
    apiKeyVar,
    apiKeyValue,
    ollamaHost,
    openaiBaseUrl,
  } = await promptModelProvider();
  console.log();

  const { host, user, pass, port } = await promptIbmiConnection();

  const displayName = await input({
    message: "Display name:",
    default: host,
  });
  console.log();

  let agentProfile: AgentProfileName;
  if (opts.agentProfile) {
    if (!VALID_AGENT_PROFILES.includes(opts.agentProfile as AgentProfileName)) {
      die(
        `Invalid --agent-profile: ${opts.agentProfile} (choose: ${VALID_AGENT_PROFILES.join(", ")})`,
      );
    }
    agentProfile = opts.agentProfile as AgentProfileName;
  } else {
    agentProfile = await promptAgentProfile();
  }
  console.log();

  // Version selection
  let version: string;
  if (opts.imageVersion) {
    version = normalizeVersion(opts.imageVersion);
  } else {
    let tags: string[] = [];
    try {
      tags = await fetchImageTags("ibmi-agi/ixora-api");
    } catch {
      warn("Could not fetch available versions from registry");
    }

    if (tags.length > 0) {
      const curVersion = envGet("IXORA_VERSION") || undefined;
      version = await select<string>({
        message: "Select image version",
        choices: tags.map((t) => ({
          value: t,
          name: t === curVersion ? `${t} (current)` : t,
        })),
      });
    } else {
      version = envGet("IXORA_VERSION") || "latest";
    }
  }
  console.log();

  // Stack profile at install time defaults to "full" (current behavior).
  // Users can switch later with `ixora start --profile mcp|cli`.
  const envConfig: EnvConfig = {
    agentModel,
    teamModel,
    apiKeyVar: apiKeyVar || undefined,
    apiKeyValue: apiKeyValue || undefined,
    ollamaHost,
    openaiBaseUrl,
    modelProviderKind: openaiBaseUrl ? "openai-compatible" : undefined,
    profile: "full",
    version,
  };

  writeEnvFile(envConfig);
  success("Wrote .env");

  // Register default system in YAML (create or overwrite)
  if (systemIdExists("default")) {
    // Reconfigure: remove old default entry before re-adding
    const { removeSystem } = await import("../lib/systems.js");
    removeSystem("default");
  }
  addSystem({
    id: "default",
    name: displayName,
    profile: agentProfile,
    agents: [],
    host,
    port,
    user: user,
    pass,
  });
  success("Wrote ixora-systems.yaml");

  writeComposeFile();
  success("Wrote docker-compose.yml");

  if (opts.pull !== false) {
    info("Pulling images...");
    await runCompose(composeCmd, ["pull"], { profile: "full" });
  }

  info("Starting services...");
  await runCompose(composeCmd, ["up", "-d", "--remove-orphans"], {
    profile: "full",
  });

  await waitForHealthy(composeCmd);

  printRunningBanner({ profile: "full" });
  console.log(
    `  Manage with: ${bold("ixora start|stop|restart|status|upgrade|config|logs")}`,
  );
  console.log(`  Config dir:  ${dim(IXORA_DIR)}`);
  console.log();
}
