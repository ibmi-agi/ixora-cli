import { describe, it, expect } from "vitest";
import { createProgram } from "../../src/cli.js";

describe("CLI program", () => {
  it("creates a program with correct name", () => {
    const program = createProgram();
    expect(program.name()).toBe("ixora");
  });

  it("has all expected commands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("install");
    expect(commandNames).toContain("start");
    expect(commandNames).toContain("stop");
    expect(commandNames).toContain("restart");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("upgrade");
    expect(commandNames).toContain("uninstall");
    expect(commandNames).toContain("logs");
    expect(commandNames).toContain("version");
    expect(commandNames).toContain("config");
    expect(commandNames).toContain("system");
  });

  it("config has subcommands", () => {
    const program = createProgram();
    const configCmd = program.commands.find((c) => c.name() === "config");
    expect(configCmd).toBeDefined();
    const subNames = configCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("show");
    expect(subNames).toContain("set");
    expect(subNames).toContain("edit");
  });

  it("system has subcommands", () => {
    const program = createProgram();
    const systemCmd = program.commands.find((c) => c.name() === "system");
    expect(systemCmd).toBeDefined();
    const subNames = systemCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("add");
    expect(subNames).toContain("remove");
    expect(subNames).toContain("list");
  });

  it("has global options", () => {
    const program = createProgram();
    const optionNames = program.options.map((o) => o.long);

    expect(optionNames).toContain("--profile");
    expect(optionNames).toContain("--image-version");
    expect(optionNames).toContain("--no-pull");
    expect(optionNames).toContain("--purge");
    expect(optionNames).toContain("--runtime");
  });

  it("parses --help without error", () => {
    const program = createProgram();
    program.exitOverride();
    try {
      program.parse(["node", "test", "--help"]);
    } catch (e: any) {
      // Commander throws on --help with exitOverride
      expect(e.code).toBe("commander.helpDisplayed");
    }
  });
});
