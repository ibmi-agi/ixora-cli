import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

describe("version command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows version number", async () => {
    // We test the version command output format via the CLI
    const { cmdVersion } = await import("../../src/commands/version.js");
    cmdVersion();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ixora 0.0.10"),
    );
  });
});
