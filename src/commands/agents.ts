import { select } from "@inquirer/prompts";
import { envGet } from "../lib/env.js";
import { ensureManifest } from "../lib/manifest.js";
import { promptComponentPicker } from "../lib/picker.js";
import {
  profileFromManifest,
  readUserProfile,
  writeUserProfile,
} from "../lib/profiles.js";
import { readSystems, setSystemMode } from "../lib/systems.js";
import { bold, die, dim, info, success, warn } from "../lib/ui.js";

/**
 * `ixora agents [system]` — focused entry point for "I want to change the
 * agents on this system." Wraps the same plumbing as `ixora config edit`
 * but skips the Full/Custom intermediate prompt: picking anything at all
 * implies Custom mode.
 *
 * When called without a system arg, surfaces a system picker first so
 * single-system users don't have to know their default system ID.
 */
export async function cmdAgentsEdit(systemId?: string): Promise<void> {
  const systems = readSystems();
  if (systems.length === 0) {
    die(
      "No systems configured. Run `ixora install` first, or `ixora system add` to register one.",
    );
  }

  let resolvedId = systemId;
  if (!resolvedId) {
    if (systems.length === 1) {
      // Single-system shortcut: skip the picker, the choice is obvious.
      resolvedId = systems[0].id;
      info(
        `Editing the only configured system: ${bold(resolvedId)} ${dim(`(${systems[0].name})`)}`,
      );
    } else {
      resolvedId = await select<string>({
        message: "Which system do you want to edit?",
        choices: systems.map((s) => ({
          value: s.id,
          name: `${s.id.padEnd(14)} ${dim(`${s.mode} — ${s.name}`)}`,
        })),
      });
    }
  } else if (!systems.some((s) => s.id === resolvedId)) {
    die(
      `System '${resolvedId}' not found. Run \`ixora system\` to see configured systems.`,
    );
  }

  const sys = systems.find((s) => s.id === resolvedId)!;

  // Fetch the manifest from the installed image. Custom-mode systems
  // pre-check the existing YAML; Full-mode systems start from "everything
  // on" so the user can uncheck what they don't want.
  const version = envGet("IXORA_VERSION") || "latest";
  info("Fetching component manifest from image...");
  const manifest = await ensureManifest(
    `ghcr.io/ibmi-agi/ixora-api:${version}`,
  );
  const seed =
    (sys.mode === "custom" && readUserProfile(resolvedId)) ||
    profileFromManifest(manifest);

  const picker = await promptComponentPicker(manifest, seed);
  if (!picker.selected) {
    warn("No components selected — leaving system unchanged.");
    return;
  }

  writeUserProfile(resolvedId, picker.profile);
  if (sys.mode !== "custom") setSystemMode(resolvedId, "custom");

  success(
    `Wrote ~/.ixora/profiles/${resolvedId}.yaml — restart to apply: ${bold(
      `ixora system restart ${resolvedId}`,
    )}`,
  );
}
