import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { IXORA_DIR } from "./constants.js";
import type { ComponentKind, Manifest } from "./manifest.js";
import { manifestComponentIds } from "./manifest.js";

/**
 * User-authored deployment profile — the YAML written by `ixora install`
 * (Custom mode) or `ixora config edit <system>`. Bind-mounted into the
 * API container at /app/app/config/deployments/_user/<id>.yaml, where
 * the existing `app/deployment.py` loader reads it with no changes.
 */
export interface UserProfile {
  include_dependencies: boolean;
  agents: string[];
  teams: string[];
  workflows: string[];
  knowledge: string[];
}

export const PROFILES_DIR = join(IXORA_DIR, "profiles");

export function userProfilePath(systemId: string): string {
  return join(PROFILES_DIR, `${systemId}.yaml`);
}

export function readUserProfile(systemId: string): UserProfile | null {
  const path = userProfilePath(systemId);
  if (!existsSync(path)) return null;
  return parseProfileYaml(readFileSync(path, "utf-8"));
}

export function writeUserProfile(
  systemId: string,
  profile: UserProfile,
): void {
  mkdirSync(PROFILES_DIR, { recursive: true });
  const path = userProfilePath(systemId);
  // .bak on overwrite — same pattern as env.ts uses for .env.bak.
  if (existsSync(path)) renameSync(path, `${path}.bak`);
  writeFileSync(path, renderProfileYaml(systemId, profile), "utf-8");
  chmodSync(path, 0o600);
}

/**
 * Remove a custom profile, leaving a .bak behind for one-step recovery.
 */
export function deleteUserProfile(systemId: string): void {
  const path = userProfilePath(systemId);
  if (existsSync(path)) renameSync(path, `${path}.bak`);
}

/**
 * Client-side mirror of `_validate_known_kind_keys` in app/deployment.py.
 * Surfaces typos at config-edit time instead of at container restart.
 *
 * Returns the IDs that don't exist in the manifest, grouped by kind.
 */
export function validateProfileAgainstManifest(
  profile: UserProfile,
  manifest: Manifest,
): { kind: ComponentKind; missing: string[] }[] {
  const known = manifestComponentIds(manifest);
  const result: { kind: ComponentKind; missing: string[] }[] = [];
  for (const kind of ["agents", "teams", "workflows", "knowledge"] as const) {
    const missing = profile[kind].filter((id) => !known.has(`${kind}:${id}`));
    if (missing.length > 0) result.push({ kind, missing });
  }
  return result;
}

/**
 * Build a UserProfile that selects every component currently in the
 * manifest. Used as the pre-selection for `ixora install --custom`
 * (so users start from "everything on" and uncheck what they don't want)
 * and as the upgrade-time default when a new agent appears.
 */
export function profileFromManifest(manifest: Manifest): UserProfile {
  return {
    include_dependencies: true,
    agents: manifest.components.agents.map((c) => c.id),
    teams: manifest.components.teams.map((c) => c.id),
    workflows: manifest.components.workflows.map((c) => c.id),
    knowledge: manifest.components.knowledge.map((c) => c.id),
  };
}

// ---------------------------------------------------------------------------
// Lightweight YAML emit / parse — same minimal-shape approach as systems.ts.
// The format is fixed (we own both writer and reader), so there's no point in
// pulling a YAML dep into the CLI just for this.
// ---------------------------------------------------------------------------

function renderProfileYaml(systemId: string, profile: UserProfile): string {
  const lines: string[] = [
    `# Custom deployment for system '${systemId}' — managed by ixora-cli.`,
    `# Bind-mounted into the API container as`,
    `# /app/app/config/deployments/_user/${systemId}.yaml — same schema as`,
    `# app/config/deployments/full.yaml. Edit via 'ixora config edit ${systemId}'.`,
    `include_dependencies: ${profile.include_dependencies ? "true" : "false"}`,
  ];
  for (const kind of ["agents", "teams", "workflows", "knowledge"] as const) {
    if (profile[kind].length === 0) {
      lines.push(`${kind}: []`);
    } else {
      lines.push(`${kind}:`);
      for (const id of profile[kind]) lines.push(`  - ${id}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseProfileYaml(raw: string): UserProfile {
  const result: UserProfile = {
    include_dependencies: true,
    agents: [],
    teams: [],
    workflows: [],
    knowledge: [],
  };
  const kinds: ComponentKind[] = ["agents", "teams", "workflows", "knowledge"];
  let currentKind: ComponentKind | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const includeMatch = trimmed.match(/^include_dependencies:\s*(true|false)/);
    if (includeMatch) {
      result.include_dependencies = includeMatch[1] === "true";
      currentKind = null;
      continue;
    }

    let matched = false;
    for (const kind of kinds) {
      const inlineEmpty = new RegExp(`^${kind}:\\s*\\[\\s*\\]\\s*$`);
      const listHeader = new RegExp(`^${kind}:\\s*$`);
      if (inlineEmpty.test(trimmed)) {
        result[kind] = [];
        currentKind = null;
        matched = true;
        break;
      }
      if (listHeader.test(trimmed)) {
        currentKind = kind;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const itemMatch = line.match(/^\s+-\s+(.+?)\s*$/);
    if (itemMatch && currentKind) {
      result[currentKind].push(itemMatch[1]);
    }
  }
  return result;
}
