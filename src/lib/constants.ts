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
// Host-side defaults sit in the 1xxxx range so the official deployment
// doesn't collide with dev stacks running ixora on the historical
// 8000/5432/3000 ports.
export const DEFAULT_API_PORT = 18000;
export const DEFAULT_DB_PORT = 15432;
export const DEFAULT_UI_PORT = 13000;

export const IXORA_DIR = join(homedir(), ".ixora");
export const COMPOSE_FILE = join(IXORA_DIR, "docker-compose.yml");
export const SYSTEMS_CONFIG = join(IXORA_DIR, "ixora-systems.yaml");
export const ENV_FILE = join(IXORA_DIR, ".env");

// Stack profiles control which containers boot (deployment shape).
// `full` boots DB + API + MCP + UI (the historical default).
// `mcp`  boots DB + API + MCP — the Carbon UI is excluded.
// `cli`  boots DB + API only — no MCP container; agents use the bundled
//        `ibmi` CLI directly (sets IXORA_CLI_MODE on the API).
export const STACK_PROFILES = {
  full: {
    name: "full",
    label: "Full",
    description: "DB + API + MCP + Carbon UI (default)",
  },
  mcp: {
    name: "mcp",
    label: "MCP backend",
    description: "DB + API + MCP (no Carbon UI) — backend-only deployment",
  },
  cli: {
    name: "cli",
    label: "CLI backend",
    description:
      "DB + API only — agents use the bundled ibmi CLI; no MCP container",
  },
} as const;

export type StackProfile = keyof typeof STACK_PROFILES;
export const VALID_STACK_PROFILES = Object.keys(
  STACK_PROFILES,
) as StackProfile[];

// Database isolation controls how the per-system api containers share the
// `agentos-db` instance. `per-system` (the default) — each system gets its
// own `ai_<id>` database, so sessions, memory, knowledge, and learning are
// isolated per IBM i system; with 2+ systems a one-shot `db-init` service
// provisions the extra databases. `shared` — every system reads/writes the
// one `ai` database. Set via the `IXORA_DB_ISOLATION` env var in
// ~/.ixora/.env (only the literal `shared` opts out).
export const DB_ISOLATION_MODES = ["per-system", "shared"] as const;
export type DbIsolationMode = (typeof DB_ISOLATION_MODES)[number];
export const DEFAULT_DB_ISOLATION: DbIsolationMode = "per-system";

// Deployment mode per system: "full" loads every component the image
// declares, "custom" loads only what's listed in
// ~/.ixora/profiles/<system-id>.yaml. The full vs custom decision lives
// per-system in ixora-systems.yaml (`sys.mode`); the bind-mounted YAML
// is what the API container reads as IAASSIST_DEPLOYMENT_CONFIG.
//
// `manifest.json` (baked into the image at build time) is the source of
// truth for what components exist — the CLI fetches it via
// `docker run --rm --entrypoint cat`, so adding a new agent on the
// API side doesn't require any CLI change beyond an `ixora upgrade`.
export const DEPLOYMENT_MODES = ["full", "custom"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

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
