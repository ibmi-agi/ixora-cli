import { existsSync, readFileSync } from "node:fs";
import { execa } from "execa";
import chalk from "chalk";
import { envGet, updateEnvKey } from "../lib/env.js";
import { ENV_FILE } from "../lib/constants.js";
import {
  die,
  success,
  info,
  maskValue,
  isSensitiveKey,
  bold,
  dim,
  cyan,
  section,
} from "../lib/ui.js";

export function cmdConfigShow(): void {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  console.log();
  console.log(`  ${chalk.bold("Configuration")}  ${ENV_FILE}`);
  console.log();

  // Model
  section("Model");
  const agentModel =
    envGet("IXORA_AGENT_MODEL") || "anthropic:claude-sonnet-4-6";
  const teamModel =
    envGet("IXORA_TEAM_MODEL") || "anthropic:claude-haiku-4-5";
  const anthKey = envGet("ANTHROPIC_API_KEY");
  const oaiKey = envGet("OPENAI_API_KEY");
  const googKey = envGet("GOOGLE_API_KEY");
  const ollamaHost = envGet("OLLAMA_HOST");

  console.log(`  ${cyan("IXORA_AGENT_MODEL")}   ${agentModel}`);
  console.log(`  ${cyan("IXORA_TEAM_MODEL")}    ${teamModel}`);
  if (anthKey) console.log(`  ${cyan("ANTHROPIC_API_KEY")}   ${maskValue(anthKey)}`);
  if (oaiKey) console.log(`  ${cyan("OPENAI_API_KEY")}      ${maskValue(oaiKey)}`);
  if (googKey) console.log(`  ${cyan("GOOGLE_API_KEY")}      ${maskValue(googKey)}`);
  if (ollamaHost) console.log(`  ${cyan("OLLAMA_HOST")}         ${ollamaHost}`);
  console.log();

  // IBM i Connection
  section("IBM i Connection");
  const db2Host = envGet("DB2i_HOST");
  const db2User = envGet("DB2i_USER");
  const db2Pass = envGet("DB2i_PASS");
  const db2Port = envGet("DB2_PORT");

  console.log(`  ${cyan("DB2i_HOST")}           ${db2Host || dim("(not set)")}`);
  console.log(`  ${cyan("DB2i_USER")}           ${db2User || dim("(not set)")}`);
  console.log(`  ${cyan("DB2i_PASS")}           ${maskValue(db2Pass)}`);
  console.log(`  ${cyan("DB2_PORT")}            ${db2Port || "8076"}`);
  console.log();

  // Deployment
  section("Deployment");
  const profile = envGet("IXORA_PROFILE") || "full";
  const version = envGet("IXORA_VERSION") || "latest";

  console.log(`  ${cyan("IXORA_PROFILE")}       ${profile}`);
  console.log(`  ${cyan("IXORA_VERSION")}       ${version}`);
  console.log();

  // Extra keys
  const knownKeys = new Set([
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "OLLAMA_HOST",
    "DB2i_HOST",
    "DB2i_USER",
    "DB2i_PASS",
    "DB2_PORT",
    "IXORA_PROFILE",
    "IXORA_VERSION",
    "IXORA_AGENT_MODEL",
    "IXORA_TEAM_MODEL",
  ]);

  const content = readFileSync(ENV_FILE, "utf-8");
  const extraLines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    const key = trimmed.split("=")[0];
    return !knownKeys.has(key);
  });

  if (extraLines.length > 0) {
    section("Other");
    for (const line of extraLines) {
      const [key, ...rest] = line.split("=");
      let val = rest.join("=").replace(/^['"]|['"]$/g, "");
      if (isSensitiveKey(key)) {
        console.log(`  ${cyan(key)}  ${maskValue(val)}`);
      } else {
        console.log(`  ${cyan(key)}  ${val}`);
      }
    }
    console.log();
  }

  console.log(`  ${dim("Edit with: ixora config edit")}`);
  console.log(`  ${dim("Set a value: ixora config set KEY VALUE")}`);
  console.log();
}

export function cmdConfigSet(key: string, value: string): void {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  updateEnvKey(key, value);
  success(`Set ${key}`);
  console.log(`  Restart to apply: ${bold("ixora restart")}`);
}

export async function cmdConfigEdit(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    die("ixora is not installed. Run: ixora install");
  }

  const editor =
    process.env["EDITOR"] ?? process.env["VISUAL"] ?? "";

  let editorCmd = editor;
  if (!editorCmd) {
    // Try common editors
    for (const candidate of ["vim", "vi", "nano"]) {
      try {
        await execa("which", [candidate]);
        editorCmd = candidate;
        break;
      } catch {
        continue;
      }
    }
  }

  if (!editorCmd) {
    die("No editor found. Set $EDITOR or install vim/nano.");
  }

  info(`Opening ${editorCmd}...`);
  await execa(editorCmd, [ENV_FILE], { stdio: "inherit" });

  console.log();
  success("Config saved");
  console.log(`  Restart to apply: ${bold("ixora restart")}`);
}
