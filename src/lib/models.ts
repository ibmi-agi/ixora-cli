import { input, password, select } from "@inquirer/prompts";
import { envGet, updateEnvKey, removeEnvKey } from "./env.js";
import { PROVIDERS, type ProviderName } from "./constants.js";
import { info, success, warn, dim } from "./ui.js";

export interface ModelProviderResult {
  provider: ProviderName;
  agentModel: string;
  teamModel: string;
  apiKeyVar: string;
  apiKeyValue: string;
  ollamaHost?: string;
  openaiBaseUrl?: string;
}

export function detectCurrentProvider(): ProviderName {
  const curAgentModel = envGet("IXORA_AGENT_MODEL");
  if (envGet("IXORA_MODEL_PROVIDER") === "openai-compatible")
    return "openai-compatible";
  if (curAgentModel.startsWith("openai:")) return "openai";
  if (curAgentModel.startsWith("google:")) return "google";
  if (curAgentModel.startsWith("ollama:")) return "ollama";
  if (curAgentModel.startsWith("anthropic:")) return "anthropic";
  return "anthropic";
}

export async function promptModelProvider(): Promise<ModelProviderResult> {
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

/** Provider-specific env keys that should be cleared when switching away. */
const PROVIDER_SPECIFIC_KEYS: Record<string, string[]> = {
  ollama: ["OLLAMA_HOST"],
  "openai-compatible": ["IXORA_OPENAI_BASE_URL", "IXORA_MODEL_PROVIDER"],
};

export function applyModelConfig(result: ModelProviderResult): void {
  updateEnvKey("IXORA_AGENT_MODEL", result.agentModel);
  updateEnvKey("IXORA_TEAM_MODEL", result.teamModel);

  if (result.apiKeyVar && result.apiKeyValue) {
    updateEnvKey(result.apiKeyVar, result.apiKeyValue);
  }

  if (result.ollamaHost) {
    updateEnvKey("OLLAMA_HOST", result.ollamaHost);
  }

  if (result.openaiBaseUrl) {
    updateEnvKey("IXORA_OPENAI_BASE_URL", result.openaiBaseUrl);
    updateEnvKey("IXORA_MODEL_PROVIDER", "openai-compatible");
  }

  // Clear stale keys from other providers
  for (const [providerKey, keys] of Object.entries(PROVIDER_SPECIFIC_KEYS)) {
    if (providerKey !== result.provider) {
      for (const key of keys) {
        removeEnvKey(key);
      }
    }
  }
}
