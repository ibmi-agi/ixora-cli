import { existsSync } from "node:fs";
import { SCRIPT_VERSION, ENV_FILE } from "../lib/constants.js";
import { envGet } from "../lib/env.js";

export function cmdVersion(): void {
  console.log(`ixora ${SCRIPT_VERSION}`);
  if (existsSync(ENV_FILE)) {
    const version = envGet("IXORA_VERSION") || "latest";
    const agentModel = envGet("IXORA_AGENT_MODEL") || "anthropic:claude-sonnet-4-6";
    console.log(`  images:  ${version}`);
    console.log(`  model:   ${agentModel}`);
  }
}
