import { AgentOSClient } from "@worksofadam/agentos-sdk";
import type { Command } from "commander";
import { getAgentOSContext } from "./agentos-context.js";

// Module-level client cache. Reused across commands within a single CLI
// invocation (same lifecycle as agno-cli's upstream cache).
let _client: AgentOSClient | null = null;

/**
 * Get or create the SDK client.
 *
 * The resolver (preAction hook) has already populated the AgentOS context
 * with {baseUrl, securityKey, timeout}. Per-command --url/--key/--timeout
 * flags can still override individual fields at call time.
 */
export function getClient(cmd?: Command): AgentOSClient {
  if (_client) return _client;

  const ctx = getAgentOSContext();
  let baseUrl = ctx.baseUrl;
  let apiKey = ctx.securityKey;
  let timeout = ctx.timeout;

  if (cmd) {
    const globals = cmd.optsWithGlobals();
    if (typeof globals.url === "string") baseUrl = globals.url;
    if (typeof globals.key === "string") apiKey = globals.key;
    if (typeof globals.timeout === "number") timeout = globals.timeout;
  }

  _client = new AgentOSClient({
    baseUrl,
    apiKey,
    timeout: timeout * 1000, // seconds -> milliseconds
  });
  return _client;
}

/**
 * Get the resolved AgentOS base URL for the current command.
 * Used to provide URL context in error messages.
 */
export function getBaseUrl(cmd?: Command): string {
  const ctx = getAgentOSContext();
  if (cmd) {
    const globals = cmd.optsWithGlobals();
    if (typeof globals.url === "string") return globals.url;
  }
  return ctx.baseUrl;
}

/**
 * Reset the cached client. Exported for testing.
 */
export function resetClient(): void {
  _client = null;
}
