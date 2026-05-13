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
  const choices: (
    | Separator
    | { name: string; value: string; checked: boolean; disabled?: string }
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
          value,
          checked: false,
          disabled: dim(`(requires ${c.gated_by})`),
        });
      } else {
        choices.push({
          name: label,
          value,
          checked: preselectedIds.has(value),
        });
      }
    }
  }

  const picked = await checkbox<string>({
    message: "Select components to enable for this system",
    choices,
    pageSize: 18,
    loop: false,
  });

  const profile: UserProfile = {
    include_dependencies: true,
    agents: [],
    teams: [],
    workflows: [],
    knowledge: [],
  };
  for (const id of picked) {
    const [kind, key] = id.split(":") as [ComponentKind, string];
    profile[kind].push(key);
  }

  return { selected: picked.length > 0, profile };
}

function renderRow(c: ManifestComponent): string {
  const description = c.description ? `  ${dim(trim(c.description))}` : "";
  return `${c.id.padEnd(28)}  ${c.label}${description}`;
}

function trim(s: string): string {
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}
