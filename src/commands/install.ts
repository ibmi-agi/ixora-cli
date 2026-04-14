import { existsSync } from "node:fs";
import { input, password, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
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
  PROFILES,
  PROVIDERS,
  type ProviderName,
  type ProfileName,
  VALID_PROFILES,
} from "../lib/constants.js";
import { info, success, warn, die, bold, dim } from "../lib/ui.js";
import { printRunningBanner } from "../lib/banner.js";
import { fetchImageTags, normalizeVersion } from "../lib/registry.js";

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
  openaiBaseUrl?: string;
}> {
  const curAgentModel = envGet("IXORA_AGENT_MODEL");

  // Detect current provider. The sentinel takes precedence over prefix
  // detection because openai-compatible also uses an `openai:` model prefix.
  let defaultProvider: ProviderName = "anthropic";
  if (envGet("IXORA_MODEL_PROVIDER") === "openai-compatible") {
    defaultProvider = "openai-compatible";
  } else if (curAgentModel.startsWith("openai:")) defaultProvider = "openai";
  else if (curAgentModel.startsWith("google:")) defaultProvider = "google";
  else if (curAgentModel.startsWith("ollama:")) defaultProvider = "ollama";

  const provider = await select<ProviderName>({
    message: "Select a model provider",
    choices: [
      {
        name: `Anthropic         ${dim("Claude Sonnet 4.6 / Haiku 4.5 (recommended)")}`,
        value: "anthropic" as const,
      },
      {
        name: `OpenAI            ${dim("GPT-4o / GPT-4o-mini")}`,
        value: "openai" as const,
      },
      {
        name: `OpenAI-compatible ${dim("OpenAI-protocol endpoint (vLLM, LiteLLM, LocalAI, ...)")}`,
        value: "openai-compatible" as const,
      },
      {
        name: `Google            ${dim("Gemini 2.5 Pro / Gemini 2.5 Flash")}`,
        value: "google" as const,
      },
      {
        name: `Ollama            ${dim("Local models via Ollama (no API key needed)")}`,
        value: "ollama" as const,
      },
      {
        name: `Custom            ${dim("Any Agno provider:model (groq, mistral, ...)")}`,
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
  let openaiBaseUrl: string | undefined;

  if (provider === "openai-compatible") {
    console.log();
    info("OpenAI-Compatible Endpoint");
    console.log();
    console.log(
      `  ${dim("Any OpenAI-protocol server: vLLM, LiteLLM, LocalAI, self-hosted fine-tunes, etc.")}`,
    );
    console.log(
      `  ${dim("Base URL should include the API version (e.g., /v1).")}`,
    );
    console.log();

    const curBaseUrl = envGet("IXORA_OPENAI_BASE_URL");
    const baseUrl = await input({
      message: "Endpoint base URL",
      default: curBaseUrl || "http://host.docker.internal:8000/v1",
      validate: (v) => (v.trim() ? true : "Base URL is required"),
    });

    const curModel = curAgentModel.startsWith("openai:")
      ? curAgentModel.slice(7)
      : "";
    const modelName = await input({
      message: "Model name",
      default: curModel || undefined,
      validate: (v) => (v.trim() ? true : "Model name is required"),
    });

    agentModel = `openai:${modelName.trim()}`;
    teamModel = `openai:${modelName.trim()}`;
    apiKeyVar = "OPENAI_API_KEY";
    openaiBaseUrl = baseUrl.trim();

    // Non-blocking reachability probe
    try {
      let testUrl = openaiBaseUrl;
      if (testUrl.includes("host.docker.internal")) {
        testUrl = testUrl.replace("host.docker.internal", "localhost");
      }
      const response = await fetch(
        `${testUrl.replace(/\/$/, "")}/models`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok || response.status === 401) {
        success("Endpoint is reachable");
      } else {
        warn(`Endpoint returned HTTP ${response.status}`);
        console.log(
          "  Install will continue; verify the URL if agents fail at runtime.",
        );
      }
    } catch {
      warn(`Could not reach ${openaiBaseUrl}`);
      console.log(
        "  Install will continue; verify the URL if agents fail at runtime.",
      );
    }
  } else if (provider === "ollama") {
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

    // Test Ollama connectivity
    try {
      let testUrl = ollamaHost;
      if (testUrl.includes("host.docker.internal")) {
        testUrl = testUrl.replace("host.docker.internal", "localhost");
      }
      const response = await fetch(`${testUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        success("Ollama is reachable");
      } else {
        warn(`Could not reach Ollama at ${testUrl}`);
        console.log(
          "  Make sure Ollama is running and accessible from Docker containers.",
        );
      }
    } catch {
      warn(`Could not reach Ollama at ${ollamaHost}`);
      console.log(
        "  Make sure Ollama is running and accessible from Docker containers.",
      );
    }
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
    const optional = provider === "openai-compatible";
    apiKeyValue = await password({
      message: optional
        ? `${apiKeyVar} (optional — leave blank if endpoint has no auth)`
        : apiKeyVar,
      validate: (value) => {
        if (optional) return true;
        if (!value && !curKey) return `${apiKeyVar} is required`;
        return true;
      },
    });
    if (!apiKeyValue && curKey) apiKeyValue = curKey;
  }

  success(`Provider: ${provider} (${agentModel})`);

  return {
    provider,
    agentModel,
    teamModel,
    apiKeyVar,
    apiKeyValue,
    ollamaHost,
    openaiBaseUrl,
  };
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

  const profile = opts.profile
    ? (opts.profile as ProfileName)
    : await promptProfile();
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

  const envConfig: EnvConfig = {
    agentModel,
    teamModel,
    apiKeyVar: apiKeyVar || undefined,
    apiKeyValue: apiKeyValue || undefined,
    ollamaHost,
    openaiBaseUrl,
    modelProviderKind: openaiBaseUrl ? "openai-compatible" : undefined,
    profile,
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
    profile,
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
    await runCompose(composeCmd, ["pull"]);
  }

  info("Starting services...");
  await runCompose(composeCmd, ["up", "-d", "--remove-orphans"]);

  await waitForHealthy(composeCmd);

  printRunningBanner();
  console.log(
    `  Manage with: ${bold("ixora start|stop|restart|status|upgrade|config|logs")}`,
  );
  console.log(`  Config dir:  ${dim(IXORA_DIR)}`);
  console.log();
}
