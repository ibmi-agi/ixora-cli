// Slash-command registry, parser, and autocomplete factory for `ixora chat`.
//
// Pure module: no TUI instance, no network. The registry uses pi-tui's own
// SlashCommand type so it plugs straight into CombinedAutocompleteProvider
// (which fuzzy-completes names in the editor); parseSlash() is the dispatcher
// the chat loop calls on submitted input.

import {
  CombinedAutocompleteProvider,
  type AutocompleteProvider,
  type SlashCommand,
} from "@earendil-works/pi-tui";

const COMMAND_NAMES = [
  "agents",
  "teams",
  "workflows",
  "sessions",
  "new",
  "clear",
  "system",
  "status",
  "tools",
  "help",
  "exit",
] as const;

export type SlashCommandName = (typeof COMMAND_NAMES)[number];

// Record over SlashCommandName so the compiler enforces full coverage.
const COMMAND_DEFS: Record<
  SlashCommandName,
  { description: string; argumentHint?: string }
> = {
  agents: {
    description: "List agents or switch the active agent",
    argumentHint: "[name]",
  },
  teams: {
    description: "List teams or switch the active team",
    argumentHint: "[name]",
  },
  workflows: {
    description: "List workflows or switch the active workflow",
    argumentHint: "[name]",
  },
  sessions: {
    description: "List sessions or resume one",
    argumentHint: "[id]",
  },
  new: { description: "Start a new session" },
  clear: { description: "Clear the screen and start a new session" },
  system: {
    description: "Show or switch the target system",
    argumentHint: "[name]",
  },
  status: { description: "Show system, entity, and session status" },
  tools: { description: "List the active entity's tools" },
  help: { description: "Show available commands" },
  exit: { description: "Exit chat" },
};

// pi-tui convention (verified in dist/autocomplete.js): `name` carries NO
// leading slash — the provider strips "/" from the editor text before
// fuzzy-matching against it.
export const SLASH_COMMANDS: readonly SlashCommand[] = COMMAND_NAMES.map(
  (name) => ({ name, ...COMMAND_DEFS[name] }),
);

export type SlashParseResult =
  /** A registered command, with whitespace-split arguments. */
  | { kind: "command"; command: SlashCommandName; args: string[] }
  /** Slash-prefixed input whose name is not registered — render as an error. */
  | { kind: "unknown"; name: string; input: string };

/**
 * Parse submitted input as a slash command.
 *
 * - Returns null for non-slash input (regular chat message; leading
 *   whitespace is ignored when detecting the "/").
 * - Command names match EXACTLY (case-insensitive) — no prefix dispatch.
 *   Prefix resolution is the autocomplete's job at typing time; dispatching
 *   prefixes here would be ambiguous (e.g. "/s" → sessions/system/status).
 * - Unknown names (including a bare "/") return kind:"unknown" so the TUI
 *   can render an actionable error instead of sending the text to the agent.
 */
export function parseSlash(input: string): SlashParseResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [name = "", ...args] = trimmed
    .slice(1)
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const command = name.toLowerCase();
  if (isCommandName(command)) {
    return { kind: "command", command, args };
  }
  return { kind: "unknown", name, input: trimmed };
}

const COMMAND_NAME_SET = new Set<string>(COMMAND_NAMES);

function isCommandName(name: string): name is SlashCommandName {
  return COMMAND_NAME_SET.has(name);
}

/**
 * Build the Editor's autocomplete provider: slash-command completion from the
 * registry plus pi-tui's built-in file completion rooted at `cwd` (harmless
 * noise for chat; fdPath defaults to null, so no external fd binary is used).
 */
export function createSlashAutocompleteProvider(
  cwd: string = process.cwd(),
): AutocompleteProvider {
  return new CombinedAutocompleteProvider([...SLASH_COMMANDS], cwd);
}
