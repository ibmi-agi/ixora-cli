import { execa } from "execa";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { IXORA_DIR } from "./constants.js";

/**
 * Component manifest baked into the API image at build time.
 *
 * Schema mirrors what `app/registry.py::emit_manifest()` emits in the
 * ibmi-agi/ixora repo. The CLI reads this from the running/installed
 * image so the Full/Custom picker doesn't have to hardcode component
 * names — every new agent on the API side flows through automatically
 * on the next upgrade.
 */
export interface ManifestComponent {
  id: string;
  label: string;
  description: string;
  dependencies: { kind: ComponentKind; key: string }[];
  /** Env var that must be set for this agent to load. null = always enabled. */
  gated_by: string | null;
}

export type ComponentKind = "agents" | "teams" | "workflows" | "knowledge";

export interface Manifest {
  version: number;
  components: Record<ComponentKind, ManifestComponent[]>;
}

export const MANIFEST_PATH_IN_IMAGE =
  "/app/app/config/deployments/manifest.json";

export const MANIFEST_CACHE = join(IXORA_DIR, "manifest.cache.json");

/**
 * Read the manifest out of a built image without starting a container.
 *
 * Uses `docker run --rm --entrypoint cat <image> /app/.../manifest.json`
 * — cheaper than `docker create` + `docker cp`, and the image is already
 * pulled by the time `install`/`upgrade` calls us.
 */
export async function fetchManifest(image: string): Promise<Manifest> {
  const { stdout } = await execa("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "cat",
    image,
    MANIFEST_PATH_IN_IMAGE,
  ]);
  return parseManifest(stdout);
}

function parseManifest(raw: string): Manifest {
  const parsed = JSON.parse(raw) as Manifest;
  if (
    !parsed ||
    typeof parsed.version !== "number" ||
    !parsed.components ||
    !Array.isArray(parsed.components.agents)
  ) {
    throw new Error(
      "manifest.json from image is missing expected shape (version, components.agents)",
    );
  }
  return parsed;
}

export function readCachedManifest(): Manifest | null {
  if (!existsSync(MANIFEST_CACHE)) return null;
  try {
    return parseManifest(readFileSync(MANIFEST_CACHE, "utf-8"));
  } catch {
    return null;
  }
}

export function cacheManifest(manifest: Manifest): void {
  mkdirSync(dirname(MANIFEST_CACHE), { recursive: true });
  writeFileSync(MANIFEST_CACHE, JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Read cache; on miss, fetch from image and cache. `force` skips cache.
 */
export async function ensureManifest(
  image: string,
  { force = false }: { force?: boolean } = {},
): Promise<Manifest> {
  if (!force) {
    const cached = readCachedManifest();
    if (cached) return cached;
  }
  const fresh = await fetchManifest(image);
  cacheManifest(fresh);
  return fresh;
}

/**
 * Flatten the manifest to a `{kind, id}` set — handy for diffs and
 * client-side validation of user-authored profiles.
 */
export function manifestComponentIds(manifest: Manifest): Set<string> {
  const ids = new Set<string>();
  for (const kind of ["agents", "teams", "workflows", "knowledge"] as const) {
    for (const c of manifest.components[kind]) {
      ids.add(`${kind}:${c.id}`);
    }
  }
  return ids;
}
