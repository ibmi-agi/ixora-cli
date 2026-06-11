import { describe, it, expect } from "vitest";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import {
  SLASH_COMMANDS,
  parseSlash,
  createSlashAutocompleteProvider,
  type SlashCommandName,
} from "../../src/lib/chat/slash.js";

const ALL_COMMANDS: SlashCommandName[] = [
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
];

describe("SLASH_COMMANDS registry", () => {
  it("contains exactly the eleven chat commands, without leading slashes", () => {
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual(ALL_COMMANDS);
  });

  it("gives every command a description", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.description, `description for /${cmd.name}`).toBeTruthy();
    }
  });

  it("hints arguments only on commands that take one", () => {
    const withHint = SLASH_COMMANDS.filter((c) => c.argumentHint).map(
      (c) => c.name,
    );
    expect(withHint).toEqual([
      "agents",
      "teams",
      "workflows",
      "sessions",
      "system",
    ]);
  });
});

describe("parseSlash", () => {
  it.each(ALL_COMMANDS)("parses /%s as a command", (name) => {
    expect(parseSlash(`/${name}`)).toEqual({
      kind: "command",
      command: name,
      args: [],
    });
  });

  it("returns null for non-slash input", () => {
    expect(parseSlash("hello world")).toBeNull();
    expect(parseSlash("")).toBeNull();
    expect(parseSlash("   ")).toBeNull();
    expect(parseSlash("what does /agents do?")).toBeNull();
  });

  it("ignores leading whitespace before the slash", () => {
    expect(parseSlash("  /exit")).toEqual({
      kind: "command",
      command: "exit",
      args: [],
    });
    expect(parseSlash("\t/help")).toEqual({
      kind: "command",
      command: "help",
      args: [],
    });
  });

  it("splits arguments on whitespace", () => {
    expect(parseSlash("/system prod")).toEqual({
      kind: "command",
      command: "system",
      args: ["prod"],
    });
    expect(parseSlash("/agents foo bar")).toEqual({
      kind: "command",
      command: "agents",
      args: ["foo", "bar"],
    });
  });

  it("collapses repeated and trailing whitespace in arguments", () => {
    expect(parseSlash("/sessions   abc \t def  ")).toEqual({
      kind: "command",
      command: "sessions",
      args: ["abc", "def"],
    });
  });

  it("matches command names case-insensitively but preserves arg case", () => {
    expect(parseSlash("/HELP")).toEqual({
      kind: "command",
      command: "help",
      args: [],
    });
    expect(parseSlash("/System PROD")).toEqual({
      kind: "command",
      command: "system",
      args: ["PROD"],
    });
  });

  it("returns a distinguishable result for unknown commands", () => {
    expect(parseSlash("/bogus")).toEqual({
      kind: "unknown",
      name: "bogus",
      input: "/bogus",
    });
    expect(parseSlash("/bogus some args")).toEqual({
      kind: "unknown",
      name: "bogus",
      input: "/bogus some args",
    });
  });

  it("treats a bare slash as unknown, not a message", () => {
    expect(parseSlash("/")).toEqual({ kind: "unknown", name: "", input: "/" });
  });

  it("does NOT dispatch prefixes — exact match only", () => {
    // "/s" is ambiguous (sessions/system/status); prefix completion is the
    // autocomplete's job at typing time, not the dispatcher's.
    const result = parseSlash("/s");
    expect(result).toEqual({ kind: "unknown", name: "s", input: "/s" });
  });
});

describe("createSlashAutocompleteProvider", () => {
  it("builds a CombinedAutocompleteProvider", () => {
    const provider = createSlashAutocompleteProvider("/tmp");
    expect(provider).toBeInstanceOf(CombinedAutocompleteProvider);
    expect(typeof provider.getSuggestions).toBe("function");
    expect(typeof provider.applyCompletion).toBe("function");
  });

  it("suggests all registry commands on a bare slash", async () => {
    const provider = createSlashAutocompleteProvider("/tmp");
    const suggestions = await provider.getSuggestions(["/"], 0, 1, {
      signal: new AbortController().signal,
    });
    expect(suggestions).not.toBeNull();
    expect(suggestions?.items.map((i) => i.value).sort()).toEqual(
      [...ALL_COMMANDS].sort(),
    );
  });

  it("fuzzy-filters slash suggestions by the typed prefix", async () => {
    const provider = createSlashAutocompleteProvider("/tmp");
    const suggestions = await provider.getSuggestions(["/age"], 0, 4, {
      signal: new AbortController().signal,
    });
    expect(suggestions?.items.map((i) => i.value)).toContain("agents");
    // prefix is the full text to be replaced (includes the slash)
    expect(suggestions?.prefix).toBe("/age");
  });
});
