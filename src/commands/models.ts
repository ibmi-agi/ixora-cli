import { existsSync } from "node:fs";
import { password, confirm } from "@inquirer/prompts";
import { envGet } from "../lib/env.js";
import { ENV_FILE, PROVIDERS, type ProviderName } from "../lib/constants.js";
import {
  die,
  success,
  info,
  maskValue,
  bold,
  dim,
  cyan,
  section,
} from "../lib/ui.js";
import {
  detectCurrentProvider,
  promptModelProvider,
  applyModelConfig,
} from "../lib/models.js";

export function cmdModelsShow(): void {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  const provider = detectCurrentProvider();
  const agentModel =
    envGet("IXORA_AGENT_MODEL") || "anthropic:claude-sonnet-4-6";
  const teamModel = envGet("IXORA_TEAM_MODEL") || "anthropic:claude-haiku-4-5";
  const providerKind = envGet("IXORA_MODEL_PROVIDER");
  const ollamaHost = envGet("OLLAMA_HOST");
  const openaiBaseUrl = envGet("IXORA_OPENAI_BASE_URL");

  // Resolve which API key to show based on detected provider
  const providerDef = PROVIDERS[provider];
  const apiKeyVar = providerDef?.apiKeyVar || "";
  const apiKeyValue = apiKeyVar ? envGet(apiKeyVar) : "";

  console.log();
  console.log(`  ${bold("Model Configuration")}`);
  console.log();
  section("Provider");
  console.log(`  ${"Provider".padEnd(20)} ${provider}`);
  console.log(`  ${"Agent model".padEnd(20)} ${agentModel}`);
  console.log(`  ${"Team model".padEnd(20)} ${teamModel}`);
  if (apiKeyVar && apiKeyValue) {
    console.log(`  ${apiKeyVar.padEnd(20)} ${maskValue(apiKeyValue)}`);
  }
  if (providerKind) {
    console.log(`  ${"Provider kind".padEnd(20)} ${providerKind}`);
  }
  if (openaiBaseUrl) {
    console.log(`  ${"Base URL".padEnd(20)} ${openaiBaseUrl}`);
  }
  if (ollamaHost) {
    console.log(`  ${"Ollama host".padEnd(20)} ${ollamaHost}`);
  }
  console.log();

  section("Available Providers");
  for (const [key, def] of Object.entries(PROVIDERS)) {
    const marker = key === provider ? cyan("*") : " ";
    console.log(`  ${marker} ${def.label.padEnd(20)} ${dim(def.description)}`);
  }
  console.log();

  console.log(`  ${dim("Switch models:  ixora models set")}`);
  console.log(
    `  ${dim("Quick switch:   ixora models set <provider>")}`,
  );
  console.log();
}

export async function cmdModelsSet(
  providerArg?: string,
): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  if (providerArg) {
    // Validate provider name
    const validProviders = Object.keys(PROVIDERS);
    if (!validProviders.includes(providerArg)) {
      die(
        `Unknown provider: ${providerArg}\n  Valid providers: ${validProviders.join(", ")}`,
      );
    }

    const provider = providerArg as ProviderName;

    // Complex providers fall through to interactive
    if (
      provider === "ollama" ||
      provider === "openai-compatible" ||
      provider === "custom"
    ) {
      info(
        `${provider} requires additional configuration. Starting interactive setup...`,
      );
      console.log();
      const result = await promptModelProvider();
      applyModelConfig(result);
      await promptRestart();
      return;
    }

    // Simple providers: use defaults, prompt for API key only if missing
    const providerDef = PROVIDERS[provider];
    let apiKeyValue = "";

    if (providerDef.apiKeyVar) {
      const existing = envGet(providerDef.apiKeyVar);
      if (!existing) {
        apiKeyValue = await password({
          message: providerDef.apiKeyVar,
          validate: (v) => (v ? true : `${providerDef.apiKeyVar} is required`),
        });
      } else {
        apiKeyValue = existing;
      }
    }

    applyModelConfig({
      provider,
      agentModel: providerDef.agentModel,
      teamModel: providerDef.teamModel,
      apiKeyVar: providerDef.apiKeyVar,
      apiKeyValue,
    });

    success(`Switched to ${providerDef.label} (${providerDef.agentModel})`);
    await promptRestart();
    return;
  }

  // No argument: full interactive wizard
  const result = await promptModelProvider();
  applyModelConfig(result);
  await promptRestart();
}

async function promptRestart(): Promise<void> {
  console.log();
  const shouldRestart = await confirm({
    message: "Restart services to apply new model?",
    default: true,
  });

  if (shouldRestart) {
    const { cmdRestart } = await import("./restart.js");
    await cmdRestart({});
  } else {
    console.log(`  Restart to apply: ${bold("ixora restart")}`);
  }
}
