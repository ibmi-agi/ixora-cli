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
  DEPLOYMENT_MODES,
  type DeploymentMode,
} from "../lib/constants.js";
import { info, success, warn, die, bold, dim } from "../lib/ui.js";
import { printRunningBanner, printUsageBanner } from "../lib/banner.js";
import { fetchImageTags, normalizeVersion } from "../lib/registry.js";
import { promptModelProvider } from "../lib/models.js";
import { ensureManifest } from "../lib/manifest.js";
import {
  promptComponentPicker,
  type ComponentPickerResult,
} from "../lib/picker.js";
import { profileFromManifest, writeUserProfile } from "../lib/profiles.js";

interface InstallOptions {
  runtime?: string;
  imageVersion?: string;
  profile?: string;
  /** "full" | "custom" — written into ixora-systems.yaml as `mode`. */
  mode?: string;
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

async function promptDeploymentMode(): Promise<DeploymentMode> {
  return await select<DeploymentMode>({
    message: "How should this system be deployed?",
    choices: [
      {
        name: `Full           ${dim("Every agent, team, and workflow the image declares")}`,
        value: "full",
      },
      {
        name: `Custom         ${dim("Pick which components to enable (writes ~/.ixora/profiles/<id>.yaml)")}`,
        value: "custom",
      },
    ],
    default: "full",
  });
}

export async function cmdInstall(opts: InstallOptions): Promise<void> {
  // Detect existing install first so the banner accurately announces
  // "Installing" vs "Reconfiguring" — previously the banner said
  // "Installing" even in reconfigure flows, which contradicted the
  // next prompt the user saw.
  const isReconfigure = existsSync(IXORA_DIR);
  info(
    `${isReconfigure ? "Reconfiguring" : "Installing"} ixora (CLI v${SCRIPT_VERSION})`,
  );
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

  if (isReconfigure) {
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

  let deploymentMode: DeploymentMode;
  if (opts.mode) {
    if (!DEPLOYMENT_MODES.includes(opts.mode as DeploymentMode)) {
      die(
        `Invalid --mode: ${opts.mode} (choose: ${DEPLOYMENT_MODES.join(", ")})`,
      );
    }
    deploymentMode = opts.mode as DeploymentMode;
  } else {
    deploymentMode = await promptDeploymentMode();
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

  // Custom mode: pull the manifest from the (just-resolved) image, let the
  // user pick components, and write the YAML the API container will
  // bind-mount on the next `docker compose up`. We do this *before* pull/up
  // so the bind source exists when compose validates the mount.
  if (deploymentMode === "custom") {
    info("Fetching component manifest from image...");
    const imageRef = `ghcr.io/ibmi-agi/ixora-api:${version}`;
    const manifest = await ensureManifest(imageRef, { force: true });
    const picker: ComponentPickerResult = await promptComponentPicker(
      manifest,
      profileFromManifest(manifest),
    );
    if (!picker.selected) {
      warn("No components selected — falling back to Full mode.");
      deploymentMode = "full";
    } else {
      writeUserProfile("default", picker.profile);
      success("Wrote ~/.ixora/profiles/default.yaml");
    }
    console.log();
  }

  // Register default system in YAML (create or overwrite)
  if (systemIdExists("default")) {
    // Reconfigure: remove old default entry before re-adding
    const { removeSystem } = await import("../lib/systems.js");
    removeSystem("default");
  }
  addSystem({
    id: "default",
    name: displayName,
    mode: deploymentMode,
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
  printUsageBanner();
  console.log(`  ${bold("Config dir:")}      ${dim(IXORA_DIR)}`);
  console.log();
}
