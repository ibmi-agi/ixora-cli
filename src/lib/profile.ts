import { envGet, updateEnvKey } from "./env.js";
import { VALID_STACK_PROFILES, type StackProfile } from "./constants.js";
import { die, warn } from "./ui.js";

const DEFAULT_STACK_PROFILE: StackProfile = "full";

export interface StackProfileOpts {
  profile?: string;
}

/**
 * Resolve the active stack profile from CLI opts, env file, and default.
 *
 * Precedence: explicit `--profile` flag > IXORA_PROFILE in .env > "full".
 *
 * Migration safety:
 *  - `--profile api` / a stored `IXORA_PROFILE=api` is the old name for the
 *    `mcp` profile — coerced to `mcp` with a one-line warning.
 *  - pre-existing `.env` files may carry an agent-profile value
 *    (sql-services|security|knowledge) under the same `IXORA_PROFILE` key.
 *    We coerce those to the default with a one-line warning instead of
 *    failing — the agent profile already lives per-system in
 *    ixora-systems.yaml, so no information is lost.
 */
export function resolveStackProfile(opts: StackProfileOpts): StackProfile {
  const explicit = opts.profile?.trim();
  if (explicit) {
    if (VALID_STACK_PROFILES.includes(explicit as StackProfile)) {
      return explicit as StackProfile;
    }
    if (explicit === "api") {
      warn("--profile api has been renamed to --profile mcp; using 'mcp'.");
      return "mcp";
    }
    die(
      `Invalid --profile: ${explicit} (choose: ${VALID_STACK_PROFILES.join(", ")})`,
    );
  }

  const stored = (envGet("IXORA_PROFILE") || "").trim();
  if (!stored) return DEFAULT_STACK_PROFILE;
  if (VALID_STACK_PROFILES.includes(stored as StackProfile)) {
    return stored as StackProfile;
  }
  if (stored === "api") {
    warn(
      "IXORA_PROFILE='api' has been renamed to 'mcp'; using 'mcp'. " +
        "Run any command with --profile mcp to update .env.",
    );
    return "mcp";
  }

  // Stale agent-profile value in .env — coerce silently if "full" (matches
  // both old and new default), warn for the rest.
  if (stored !== DEFAULT_STACK_PROFILE) {
    warn(
      `IXORA_PROFILE='${stored}' is not a stack profile; using '${DEFAULT_STACK_PROFILE}'. ` +
        `Stack profiles are: ${VALID_STACK_PROFILES.join(", ")}.`,
    );
  }
  return DEFAULT_STACK_PROFILE;
}

export function persistStackProfile(profile: StackProfile): void {
  updateEnvKey("IXORA_PROFILE", profile);
}

export function wasProfileExplicit(opts: StackProfileOpts): boolean {
  return Boolean(opts.profile?.trim());
}
