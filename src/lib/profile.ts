import { envGet, updateEnvKey } from "./env.js";
import {
  VALID_STACK_PROFILES,
  VALID_AGENT_PROFILES,
  type StackProfile,
} from "./constants.js";
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
 * Migration safety: pre-existing `.env` files may carry an agent-profile
 * value (sql-services|security|knowledge) under the same `IXORA_PROFILE`
 * key. We coerce those to the default with a one-line warning instead of
 * failing — the agent profile already lives per-system in ixora-systems.yaml,
 * so no information is lost.
 */
export function resolveStackProfile(opts: StackProfileOpts): StackProfile {
  const explicit = opts.profile?.trim();
  if (explicit) {
    if (VALID_STACK_PROFILES.includes(explicit as StackProfile)) {
      return explicit as StackProfile;
    }
    if (VALID_AGENT_PROFILES.includes(explicit as never)) {
      die(
        `--profile values are now ${VALID_STACK_PROFILES.join("|")}. ` +
          `For agent profiles, use --agent-profile (e.g., --agent-profile ${explicit}).`,
      );
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
