import { homedir } from "node:os";
import { join } from "node:path";

export const SCRIPT_VERSION = "0.0.10";
export const HEALTH_TIMEOUT = 30;

export const IXORA_DIR = join(homedir(), ".ixora");
export const COMPOSE_FILE = join(IXORA_DIR, "docker-compose.yml");
export const SYSTEMS_CONFIG = join(IXORA_DIR, "ixora-systems.yaml");
export const ENV_FILE = join(IXORA_DIR, ".env");

export const PROFILES = {
  full: {
    name: "full",
    label: "Full",
    description: "All agents, teams, and workflows (3 agents, 2 teams, 1 workflow)",
  },
  "sql-services": {
    name: "sql-services",
    label: "SQL Services",
    description: "SQL Services agent for database queries and performance monitoring",
  },
  security: {
    name: "security",
    label: "Security",
    description: "Security agent, multi-system security team, and assessment workflow",
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
    description: "Enter provider:model strings",
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
