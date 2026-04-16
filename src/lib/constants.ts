import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read the CLI version from package.json at runtime.
 *
 * Walks upward from this module's location looking for a package.json whose
 * `name` matches our package. Works in both the bundled dist/ layout
 * (dist/*.js → ../package.json) and the unbundled dev layout
 * (src/lib/constants.ts → ../../package.json) without needing build config.
 */
function readCliVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (pkg.name === "@ibm/ixora" && pkg.version) return pkg.version;
    } catch {
      // not here — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

export const SCRIPT_VERSION = readCliVersion();
export const HEALTH_TIMEOUT = 30;
export const DEFAULT_API_PORT = 8000;

export const IXORA_DIR = join(homedir(), ".ixora");
export const COMPOSE_FILE = join(IXORA_DIR, "docker-compose.yml");
export const SYSTEMS_CONFIG = join(IXORA_DIR, "ixora-systems.yaml");
export const ENV_FILE = join(IXORA_DIR, ".env");

export const PROFILES = {
  full: {
    name: "full",
    label: "Full",
    description:
      "All agents, teams, and workflows (3 agents, 2 teams, 1 workflow)",
  },
  "sql-services": {
    name: "sql-services",
    label: "SQL Services",
    description:
      "SQL Services agent for database queries and performance monitoring",
  },
  security: {
    name: "security",
    label: "Security",
    description:
      "Security agent, multi-system security team, and assessment workflow",
  },
  knowledge: {
    name: "knowledge",
    label: "Knowledge",
    description: "Knowledge agent only — documentation retrieval (lightest)",
  },
} as const;

export type ProfileName = keyof typeof PROFILES;
export const VALID_PROFILES = Object.keys(PROFILES) as ProfileName[];

export interface ProviderDef {
  name: string;
  label: string;
  agentModel: string;
  teamModel: string;
  apiKeyVar: string;
  description: string;
}

export const PROVIDERS: Record<string, ProviderDef> = {
  anthropic: {
    name: "anthropic",
    label: "Anthropic",
    agentModel: "anthropic:claude-sonnet-4-6",
    teamModel: "anthropic:claude-haiku-4-5",
    apiKeyVar: "ANTHROPIC_API_KEY",
    description: "Claude Sonnet 4.6 / Haiku 4.5 (recommended)",
  },
  openai: {
    name: "openai",
    label: "OpenAI",
    agentModel: "openai:gpt-4o",
    teamModel: "openai:gpt-4o-mini",
    apiKeyVar: "OPENAI_API_KEY",
    description: "GPT-4o / GPT-4o-mini",
  },
  "openai-compatible": {
    name: "openai-compatible",
    label: "OpenAI-compatible",
    agentModel: "",
    teamModel: "",
    apiKeyVar: "OPENAI_API_KEY",
    description: "OpenAI-protocol endpoint (vLLM, LiteLLM, LocalAI, ...)",
  },
  google: {
    name: "google",
    label: "Google",
    agentModel: "google:gemini-2.5-pro",
    teamModel: "google:gemini-2.5-flash",
    apiKeyVar: "GOOGLE_API_KEY",
    description: "Gemini 2.5 Pro / Gemini 2.5 Flash",
  },
  ollama: {
    name: "ollama",
    label: "Ollama",
    agentModel: "ollama:llama3.1",
    teamModel: "ollama:llama3.1",
    apiKeyVar: "",
    description: "Local models via Ollama (no API key needed)",
  },
  custom: {
    name: "custom",
    label: "Custom",
    agentModel: "",
    teamModel: "",
    apiKeyVar: "",
    description: "Any Agno provider:model (groq, mistral, ...)",
  },
};

export type ProviderName = keyof typeof PROVIDERS;

export const ALL_AGENTS = [
  "ibmi-security-assistant",
  "ibmi-system-health",
  "ibmi-db-explorer",
  "ibmi-db-performance",
  "ibmi-work-management",
  "ibmi-system-config",
  "ibmi-sql-service-guide",
  "ibmi-knowledge-agent",
] as const;

export const OPS_AGENTS = [
  "ibmi-system-health",
  "ibmi-db-explorer",
  "ibmi-db-performance",
  "ibmi-work-management",
  "ibmi-system-config",
  "ibmi-sql-service-guide",
] as const;

export const AGENT_PRESETS = {
  all: [...ALL_AGENTS],
  "security-ops": ["ibmi-security-assistant", ...OPS_AGENTS],
  security: ["ibmi-security-assistant"],
  operations: [...OPS_AGENTS],
  knowledge: ["ibmi-knowledge-agent"],
} as const;
