// Process-level context for AgentOS commands.
//
// The preAction hook on the root program runs the resolver, computes which
// local AgentOS endpoint to talk to, and stashes the result here. Ported
// agno-cli commands read it through `getClient()` / `getBaseUrl()` instead
// of agno-cli's per-command Commander-walk pattern. This keeps the ported
// commands close to upstream while replacing the source of truth.

export interface ResolvedAgentOSContext {
  /** Fully qualified AgentOS base URL, e.g. http://localhost:18001 */
  baseUrl: string;
  /** Optional API key (SYSTEM_<ID>_AGENTOS_KEY). Empty/undefined for local unauth */
  securityKey?: string;
  /** Request timeout in seconds (SDK expects ms; client multiplies) */
  timeout: number;
  /** System ID this context resolves to. undefined when --url override is in use */
  systemId?: string;
}

let _ctx: ResolvedAgentOSContext | null = null;

export function setAgentOSContext(ctx: ResolvedAgentOSContext): void {
  _ctx = ctx;
}

export function getAgentOSContext(): ResolvedAgentOSContext {
  if (!_ctx) {
    throw new Error(
      "AgentOS context not initialised. The preAction hook should set this before any AgentOS command runs.",
    );
  }
  return _ctx;
}

export function clearAgentOSContext(): void {
  _ctx = null;
}
