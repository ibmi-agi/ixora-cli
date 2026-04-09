import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("version command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows version number", async () => {
    const { cmdVersion } = await import("../../src/commands/version.js");
    await cmdVersion();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ixora 0.1.0"),
    );
  });
});
