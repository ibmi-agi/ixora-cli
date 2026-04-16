import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_API_PORT, ENV_FILE, IXORA_DIR } from "./constants.js";

function sqEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function envGet(key: string, envFile: string = ENV_FILE): string {
  if (!existsSync(envFile)) return "";

  const content = readFileSync(envFile, "utf-8");
  for (const line of content.split("\n")) {
    if (line.startsWith(`${key}=`)) {
      let val = line.slice(key.length + 1);
      // Strip surrounding quotes (matched pairs only)
      if (
        (val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))
      ) {
        val = val.slice(1, -1);
      }
      return val;
    }
  }
  return "";
}

export interface EnvConfig {
  agentModel: string;
  teamModel: string;
  apiKeyVar?: string;
  apiKeyValue?: string;
  ollamaHost?: string;
  openaiBaseUrl?: string;
  modelProviderKind?: string;
  profile: string;
  version: string;
}

const KNOWN_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "OLLAMA_HOST",
  "IXORA_OPENAI_BASE_URL",
  "IXORA_MODEL_PROVIDER",
  "DB2i_HOST",
  "DB2i_USER",
  "DB2i_PASS",
  "DB2_PORT",
  "IXORA_PROFILE",
  "IXORA_VERSION",
  "IXORA_PREVIOUS_VERSION",
  "IXORA_AGENT_MODEL",
  "IXORA_TEAM_MODEL",
  "IXORA_API_PORT",
];

export function writeEnvFile(
  config: EnvConfig,
  envFile: string = ENV_FILE,
): void {
  mkdirSync(dirname(envFile), { recursive: true });

  // Preserve any extra keys the user may have added manually
  let extra = "";
  let prevVersionLine = "";
  if (existsSync(envFile)) {
    const existing = readFileSync(envFile, "utf-8");
    const lines = existing.split("\n");
    const extraLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return false;
      const lineKey = trimmed.split("=")[0];
      return !KNOWN_KEYS.includes(lineKey);
    });
    extra = extraLines.join("\n");
    const pvLine = lines.find((l) =>
      l.startsWith("IXORA_PREVIOUS_VERSION="),
    );
    if (pvLine) prevVersionLine = pvLine;
  }

  let content = `# Model provider
IXORA_AGENT_MODEL='${sqEscape(config.agentModel)}'
IXORA_TEAM_MODEL='${sqEscape(config.teamModel)}'
`;

  if (config.apiKeyVar && config.apiKeyValue) {
    content += `${config.apiKeyVar}='${sqEscape(config.apiKeyValue)}'\n`;
  }

  if (config.ollamaHost) {
    content += `OLLAMA_HOST='${sqEscape(config.ollamaHost)}'\n`;
  }

  if (config.openaiBaseUrl) {
    content += `IXORA_OPENAI_BASE_URL='${sqEscape(config.openaiBaseUrl)}'\n`;
  }

  if (config.modelProviderKind) {
    content += `IXORA_MODEL_PROVIDER='${sqEscape(config.modelProviderKind)}'\n`;
  }

  content += `
# Deployment
IXORA_PROFILE='${sqEscape(config.profile)}'
IXORA_VERSION='${sqEscape(config.version)}'
`;

  // Preserve previous version if set (written by upgrade command)
  if (prevVersionLine) {
    content += `${prevVersionLine}\n`;
  }

  if (extra) {
    content += `\n# Preserved user settings\n${extra}\n`;
  }

  writeFileSync(envFile, content, "utf-8");
  chmodSync(envFile, 0o600);
}

export function updateEnvKey(
  key: string,
  value: string,
  envFile: string = ENV_FILE,
): void {
  const escaped = sqEscape(value);

  if (existsSync(envFile)) {
    const content = readFileSync(envFile, "utf-8");
    const lines = content.split("\n");
    let found = false;

    const updated = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}='${escaped}'`;
      }
      return line;
    });

    if (found) {
      writeFileSync(envFile, updated.join("\n"), "utf-8");
    } else {
      // Ensure trailing newline before appending
      const existing = readFileSync(envFile, "utf-8");
      const suffix = existing.endsWith("\n") ? "" : "\n";
      writeFileSync(
        envFile,
        `${existing}${suffix}${key}='${escaped}'\n`,
        "utf-8",
      );
    }
  } else {
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, `${key}='${escaped}'\n`, "utf-8");
  }

  chmodSync(envFile, 0o600);
}

export function getApiPortBase(envFile: string = ENV_FILE): number {
  const raw = envGet("IXORA_API_PORT", envFile);
  if (!raw) return DEFAULT_API_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    console.warn(
      `Invalid IXORA_API_PORT='${raw}' (must be integer 1024-65535); using default ${DEFAULT_API_PORT}`,
    );
    return DEFAULT_API_PORT;
  }
  return n;
}

export function removeEnvKey(
  key: string,
  envFile: string = ENV_FILE,
): void {
  if (!existsSync(envFile)) return;
  const content = readFileSync(envFile, "utf-8");
  const lines = content.split("\n").filter((line) => !line.startsWith(`${key}=`));
  writeFileSync(envFile, lines.join("\n"), "utf-8");
  chmodSync(envFile, 0o600);
}
