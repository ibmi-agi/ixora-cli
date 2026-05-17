import { describe, it, expect, vi } from "vitest";
import { createProgram } from "../../src/cli.js";

describe("CLI program", () => {
  it("creates a program with correct name", () => {
    const program = createProgram();
    expect(program.name()).toBe("ixora");
  });

  it("exposes the stack group at top level", () => {
    const program = createProgram();
    const topNames = program.commands.map((c) => c.name());
    expect(topNames).toContain("stack");
  });

  it("stack group contains every relocated command", () => {
    const program = createProgram();
    const stackCmd = program.commands.find((c) => c.name() === "stack");
    expect(stackCmd).toBeDefined();
    const stackSubNames = stackCmd!.commands.map((c) => c.name());

    expect(stackSubNames).toContain("install");
    expect(stackSubNames).toContain("start");
    expect(stackSubNames).toContain("stop");
    expect(stackSubNames).toContain("restart");
    expect(stackSubNames).toContain("status");
    expect(stackSubNames).toContain("upgrade");
    expect(stackSubNames).toContain("uninstall");
    expect(stackSubNames).toContain("logs");
    expect(stackSubNames).toContain("version");
    expect(stackSubNames).toContain("config");
    expect(stackSubNames).toContain("agents");
    expect(stackSubNames).toContain("components");
    expect(stackSubNames).toContain("system");
    expect(stackSubNames).toContain("models");
  });

  it("stack config has subcommands", () => {
    const program = createProgram();
    const stackCmd = program.commands.find((c) => c.name() === "stack");
    const configCmd = stackCmd!.commands.find((c) => c.name() === "config");
    expect(configCmd).toBeDefined();
    const subNames = configCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("show");
    expect(subNames).toContain("set");
    expect(subNames).toContain("edit");
  });

  it("stack system has subcommands", () => {
    const program = createProgram();
    const stackCmd = program.commands.find((c) => c.name() === "stack");
    const systemCmd = stackCmd!.commands.find((c) => c.name() === "system");
    expect(systemCmd).toBeDefined();
    const subNames = systemCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("add");
    expect(subNames).toContain("remove");
    expect(subNames).toContain("list");
    expect(subNames).toContain("default");
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

  it("registers hidden top-level hints for stack-only commands", () => {
    const program = createProgram();
    const hintNames = [
      "install",
      "start",
      "stop",
      "restart",
      "upgrade",
      "uninstall",
      "logs",
      "config",
      "system",
      "version",
    ];
    for (const name of hintNames) {
      const cmd = program.commands.find((c) => c.name() === name);
      expect(cmd, `top-level hint for '${name}' must exist`).toBeDefined();
      // Hidden so they don't pollute `--help`.
      // commander exposes the hidden flag via the internal `_hidden` property.
      expect(
        (cmd as unknown as { _hidden: boolean })._hidden,
        `hint '${name}' must be hidden`,
      ).toBe(true);
    }
  });

  it("hint shim points at the stack subcommand and exits non-zero", async () => {
    const program = createProgram();
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // The shim calls process.exit(1) directly. Throw from the mock so the
    // shim aborts cleanly without killing vitest.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("__exit__");
      }) as never);
    let exitCode: number | undefined;
    try {
      await program.parseAsync(["node", "test", "restart"]);
    } catch (e) {
      if ((e as Error).message !== "__exit__") throw e;
      exitCode = exitSpy.mock.calls[0]?.[0] as number;
    }
    expect(exitCode).toBe(1);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toContain("ixora stack restart");
    expect(stderr).toContain("ixora stack --help");
    errSpy.mockRestore();
    exitSpy.mockRestore();
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
