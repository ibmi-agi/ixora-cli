import { envGet } from "../lib/env.js";
import { ensureManifest } from "../lib/manifest.js";
import type { ComponentKind } from "../lib/manifest.js";
import { bold, cyan, dim, info, warn } from "../lib/ui.js";

interface ComponentsListOpts {
  refresh?: boolean;
  image?: string;
}

const KIND_LABELS: Record<ComponentKind, string> = {
  agents: "Agents",
  teams: "Teams",
  workflows: "Workflows",
  knowledge: "Knowledge bases",
};

/**
 * Print every deployable component the installed image declares.
 *
 * Hits the cache (`~/.ixora/manifest.cache.json`) by default; pass
 * `--refresh` to re-fetch from the image. `--image` overrides the
 * image reference used for the fetch (defaults to the version
 * pinned in `.env`).
 */
export async function cmdComponentsList(
  opts: ComponentsListOpts = {},
): Promise<void> {
  const image = resolveImageRef(opts.image);
  const manifest = await ensureManifest(image, { force: Boolean(opts.refresh) });

  const stats = (Object.keys(KIND_LABELS) as ComponentKind[]).map((kind) => {
    const total = manifest.components[kind].length;
    const gated = manifest.components[kind].filter(
      (c) => c.gated_by !== null,
    ).length;
    return { kind, total, gated };
  });

  info(
    `Components from ${image} (manifest v${manifest.version}, ${stats
      .map((s) => `${s.total} ${s.kind}`)
      .join(" / ")})`,
  );
  console.log();

  for (const kind of Object.keys(KIND_LABELS) as ComponentKind[]) {
    const items = manifest.components[kind];
    if (items.length === 0) continue;
    console.log(`  ${bold(KIND_LABELS[kind])}`);
    for (const item of items) {
      const gateNote = item.gated_by
        ? `  ${dim(`(requires ${item.gated_by})`)}`
        : "";
      console.log(`  ${cyan(item.id.padEnd(28))}  ${item.label}${gateNote}`);
      if (item.description) {
        console.log(`    ${dim(truncate(item.description, 110))}`);
      }
      if (item.dependencies.length > 0) {
        const deps = item.dependencies
          .map((d) => `${d.kind}:${d.key}`)
          .join(", ");
        console.log(`    ${dim(`depends on: ${deps}`)}`);
      }
    }
    console.log();
  }

  const gatedCount = stats.reduce((sum, s) => sum + s.gated, 0);
  if (gatedCount > 0) {
    warn(
      `${gatedCount} component(s) are env-gated and not enabled in this image. ` +
        `Set their flag (e.g., IXORA_ENABLE_BUILDER=true) to surface them.`,
    );
  }
}

function resolveImageRef(override?: string): string {
  if (override) return override;
  const version = envGet("IXORA_VERSION") || "latest";
  return `ghcr.io/ibmi-agi/ixora-api:${version}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
