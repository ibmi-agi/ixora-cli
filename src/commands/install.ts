import { existsSync } from "node:fs";
import {
  input,
  password,
  select,
  confirm,
} from "@inquirer/prompts";
import chalk from "chalk";
import { envGet, writeEnvFile, type EnvConfig } from "../lib/env.js";
import { writeComposeFile, runCompose } from "../lib/compose.js";
import {
  detectComposeCmd,
  verifyRuntimeRunning,
  detectPlatform,
} from "../lib/platform.js";
import { waitForHealthy } from "../lib/health.js";
import {
  SCRIPT_VERSION,
  IXORA_DIR,
  PROFILES,
  PROVIDERS,
  type ProviderName,
  type ProfileName,
  VALID_PROFILES,
} from "../lib/constants.js";
import { info, success, warn, die, bold, dim } from "../lib/ui.js";

interface InstallOptions {
  runtime?: string;
  imageVersion?: string;
  profile?: string;
  pull?: boolean;
}

async function promptModelProvider(): Promise<{
  provider: ProviderName;
  agentModel: string;
  teamModel: string;
  apiKeyVar: string;
  apiKeyValue: string;
  ollamaHost?: string;
}> {
  const curAgentModel = envGet("IXORA_AGENT_MODEL");

  // Detect current provider
  let defaultProvider: ProviderName = "anthropic";
  if (curAgentModel.startsWith("openai:")) defaultProvider = "openai";
  else if (curAgentModel.startsWith("google:")) defaultProvider = "google";
  else if (curAgentModel.startsWith("ollama:")) defaultProvider = "ollama";

  const provider = await select<ProviderName>({
    message: "Select a model provider",
    choices: [
      {
        name: `Anthropic     ${dim("Claude Sonnet 4.6 / Haiku 4.5 (recommended)")}`,
        value: "anthropic" as const,
      },
      {
        name: `OpenAI        ${dim("GPT-4o / GPT-4o-mini")}`,
        value: "openai" as const,
      },
      {
        name: `Google        ${dim("Gemini 2.5 Pro / Gemini 2.5 Flash")}`,
        value: "google" as const,
      },
      {
        name: `Ollama        ${dim("Local models via Ollama (no API key needed)")}`,
        value: "ollama" as const,
      },
      {
        name: `Custom        ${dim("Enter provider:model strings")}`,
        value: "custom" as const,
      },
    ],
    default: defaultProvider,
  });

  const providerDef = PROVIDERS[provider];
  let agentModel = providerDef.agentModel;
  let teamModel = providerDef.teamModel;
  let apiKeyVar = providerDef.apiKeyVar;
  let apiKeyValue = "";
  let ollamaHost: string | undefined;

  if (provider === "ollama") {
    // Ollama setup
    console.log();
    info("Ollama Setup");
    console.log();
    console.log(
      `  ${dim("Ollama must be running on your machine and listening on all interfaces.")}`,
    );
    console.log(
      `  ${dim("Default URL works for macOS and Windows (Docker Desktop).")}`,
    );
    console.log(
      `  ${dim("Linux users: use your host IP (e.g., http://172.17.0.1:11434).")}`,
    );
    console.log();

    const curOllamaHost = envGet("OLLAMA_HOST");
    ollamaHost = await input({
      message: "Ollama URL",
      default: curOllamaHost || "http://host.docker.internal:11434",
    });

    const curModel = curAgentModel.startsWith("ollama:")
      ? curAgentModel.slice(7)
      : "llama3.1";

    const modelName = await input({
      message: "Model name",
      default: curModel,
    });

    agentModel = `ollama:${modelName}`;
    teamModel = `ollama:${modelName}`;
  } else if (provider === "custom") {
    const curAm = envGet("IXORA_AGENT_MODEL");
    const curTm = envGet("IXORA_TEAM_MODEL");

    agentModel = await input({
      message: "Agent model (provider:model)",
      default: curAm || "anthropic:claude-sonnet-4-6",
    });

    teamModel = await input({
      message: "Team model (provider:model)",
      default: curTm || "anthropic:claude-haiku-4-5",
    });

    apiKeyVar = await input({
      message: "API key env var name (e.g., ANTHROPIC_API_KEY)",
    });
  }

  // Prompt for API key if needed
  if (apiKeyVar) {
    const curKey = envGet(apiKeyVar);
    apiKeyValue = await password({
      message: apiKeyVar,
      validate: (value) => {
        if (!value && !curKey) return `${apiKeyVar} is required`;
        return true;
      },
    });
    if (!apiKeyValue && curKey) apiKeyValue = curKey;
  }

  success(`Provider: ${provider} (${agentModel})`);

  return { provider, agentModel, teamModel, apiKeyVar, apiKeyValue, ollamaHost };
}

async function promptIbmiConnection(): Promise<{
  host: string;
  user: string;
  pass: string;
}> {
  info("IBM i Connection");
  console.log();

  const curHost = envGet("DB2i_HOST");
  const curUser = envGet("DB2i_USER");
  const curPass = envGet("DB2i_PASS");

  const host = await input({
    message: "IBM i hostname",
    default: curHost || undefined,
    validate: (value) => (value.trim() ? true : "IBM i hostname is required"),
  });

  const user = await input({
    message: "IBM i username",
    default: curUser || undefined,
    validate: (value) => (value.trim() ? true : "IBM i username is required"),
  });

  const pass = await password({
    message: "IBM i password",
    validate: (value) => {
      if (!value && !curPass) return "IBM i password is required";
      return true;
    },
  });

  return { host: host.trim(), user: user.trim(), pass: pass || curPass };
}

async function promptProfile(): Promise<ProfileName> {
  const curProfile = (envGet("IXORA_PROFILE") || "full") as ProfileName;

  const profile = await select<ProfileName>({
    message: "Select an agent profile",
    choices: VALID_PROFILES.map((p) => ({
      name: `${PROFILES[p].name.padEnd(14)} ${dim(PROFILES[p].description)}`,
      value: p,
    })),
    default: curProfile,
  });

  success(`Profile: ${profile}`);
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
        { name: "Reconfigure — re-run setup prompts (overwrites current config)", value: "reconfigure" },
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

  const { agentModel, teamModel, apiKeyVar, apiKeyValue, ollamaHost } =
    await promptModelProvider();
  console.log();

  const { host, user, pass } = await promptIbmiConnection();
  console.log();

  const profile = opts.profile
    ? (opts.profile as ProfileName)
    : await promptProfile();
  console.log();

  const version = opts.imageVersion ?? envGet("IXORA_VERSION") ?? "latest";

  const envConfig: EnvConfig = {
    agentModel,
    teamModel,
    apiKeyVar: apiKeyVar || undefined,
    apiKeyValue: apiKeyValue || undefined,
    ollamaHost,
    db2Host: host,
    db2User: user,
    db2Pass: pass,
    profile,
    version,
  };

  writeComposeFile();
  success("Wrote docker-compose.yml");

  writeEnvFile(envConfig);
  success("Wrote .env");

  if (opts.pull !== false) {
    info("Pulling images...");
    await runCompose(composeCmd, ["pull"]);
  }

  info("Starting services...");
  await runCompose(composeCmd, ["up", "-d"]);

  await waitForHealthy(composeCmd);

  console.log();
  success("ixora is running!");
  console.log();
  console.log(`  ${bold("UI:")}   http://localhost:3000`);
  console.log(`  ${bold("API:")}  http://localhost:8000`);
  console.log(`  ${bold("Profile:")} ${profile}`);
  console.log();
  console.log(
    `  Manage with: ${bold("ixora-cli start|stop|restart|status|upgrade|config|logs")}`,
  );
  console.log(`  Config dir:  ${dim(IXORA_DIR)}`);
  console.log();
}
