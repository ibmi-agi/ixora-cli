import readline from "node:readline";
import { checkbox, Separator } from "@inquirer/prompts";
import type { ComponentKind, Manifest, ManifestComponent } from "./manifest.js";
import type { UserProfile } from "./profiles.js";
import { dim } from "./ui.js";

export interface ComponentPickerResult {
  /** Whether the user actually selected anything (false = bail). */
  selected: boolean;
  /** Component IDs the user kept checked, grouped by kind. */
  profile: UserProfile;
}

const KIND_ORDER: ComponentKind[] = [
  "agents",
  "teams",
  "workflows",
  "knowledge",
];

const KIND_LABEL: Record<ComponentKind, string> = {
  agents: "Agents",
  teams: "Teams",
  workflows: "Workflows",
  knowledge: "Knowledge bases",
};

/**
 * Single-screen multi-select that groups every component in the manifest
 * by kind, pre-checked from `preselected`. Env-gated rows are surfaced
 * but unselectable so the user sees what *would* be available with the
 * right env var set.
 */
export async function promptComponentPicker(
  manifest: Manifest,
  preselected: UserProfile,
): Promise<ComponentPickerResult> {
  // `name` is the fully-rendered row shown in the picker UI; `short` is
  // what inquirer joins into the post-selection echo line. Without it,
  // confirming a multi-select with rich `name` strings produces a wall
  // of comma-joined render output — `short: c.id` keeps the answer
  // summary compact and grep-friendly ("ibmi-system-health, ibmi-team, …").
  const choices: (
    | Separator
    | {
        name: string;
        short: string;
        value: string;
        checked: boolean;
        disabled?: string;
      }
  )[] = [];

  const preselectedIds = new Set<string>();
  for (const kind of KIND_ORDER) {
    for (const id of preselected[kind]) preselectedIds.add(`${kind}:${id}`);
  }

  for (const kind of KIND_ORDER) {
    const items = manifest.components[kind];
    if (items.length === 0) continue;
    choices.push(new Separator(`-- ${KIND_LABEL[kind]} --`));
    for (const c of items) {
      const value = `${kind}:${c.id}`;
      const label = renderRow(c);
      if (c.gated_by) {
        choices.push({
          name: label,
          short: c.id,
          value,
          checked: false,
          disabled: dim(`(requires ${c.gated_by})`),
        });
      } else {
        choices.push({
          name: label,
          short: c.id,
          value,
          checked: preselectedIds.has(value),
        });
      }
    }
  }

  // Esc-to-cancel: piggy-back on inquirer's raw-mode stdin so a keypress
  // listener can spot the escape key and abort the prompt's controller.
  // emitKeypressEvents is idempotent — calling it before inquirer wires
  // its own reader is safe and ensures the listener fires even if our
  // call lands first.
  if (process.stdin.isTTY) readline.emitKeypressEvents(process.stdin);
  const ac = new AbortController();
  const onKey = (
    _ch: string | undefined,
    key: { name?: string } | undefined,
  ): void => {
    if (key?.name === "escape") ac.abort();
  };
  process.stdin.on("keypress", onKey);

  let picked: string[];
  try {
    picked = await checkbox<string>(
      {
        message:
          "Select components to enable for this system (Esc to cancel)",
        choices,
        pageSize: 18,
        loop: false,
      },
      { signal: ac.signal },
    );
  } catch (e) {
    // AbortPromptError (Esc) is the user bailing — return a "no selection"
    // result so call sites can warn and skip writes. Other errors propagate
    // unchanged so genuine failures still surface.
    if ((e as Error)?.name === "AbortPromptError") {
      return { selected: false, profile: emptyProfile() };
    }
    throw e;
  } finally {
    process.stdin.off("keypress", onKey);
  }

  const profile = emptyProfile();
  for (const id of picked) {
    const [kind, key] = id.split(":") as [ComponentKind, string];
    profile[kind].push(key);
  }

  return { selected: picked.length > 0, profile };
}

function emptyProfile(): UserProfile {
  return {
    include_dependencies: true,
    agents: [],
    teams: [],
    workflows: [],
    knowledge: [],
  };
}

function renderRow(c: ManifestComponent): string {
  const description = c.description ? `  ${dim(trim(c.description))}` : "";
  return `${c.id.padEnd(28)}  ${c.label}${description}`;
}

function trim(s: string): string {
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}
