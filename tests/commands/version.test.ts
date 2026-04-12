import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(
    join(fileURLToPath(import.meta.url), "..", "..", "..", "package.json"),
    "utf8",
  ),
) as { version: string };

describe("version command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows version number from package.json", async () => {
    const { cmdVersion } = await import("../../src/commands/version.js");
    await cmdVersion();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(`ixora ${pkg.version}`),
    );
  });
});
