import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-logs-"));

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/constants.js")>("../../src/lib/constants.js");
  return {
    ...actual,
    IXORA_DIR: tmpDir,
    ENV_FILE: join(tmpDir, ".env"),
    COMPOSE_FILE: join(tmpDir, "docker-compose.yml"),
    SYSTEMS_CONFIG: join(tmpDir, "ixora-systems.yaml"),
  };
});

vi.mock("../../src/lib/platform.js", () => ({
  detectComposeCmd: vi.fn().mockResolvedValue("docker compose"),
  verifyRuntimeRunning: vi.fn().mockResolvedValue(undefined),
  detectPlatform: vi.fn().mockReturnValue({}),
  getComposeParts: vi.fn().mockReturnValue(["docker", ["compose"]]),
  getRuntimeBin: vi.fn().mockReturnValue("docker"),
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

describe("logs command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(join(tmpDir, "docker-compose.yml"), "services: {}");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("requires compose file", async () => {
    const { existsSync, unlinkSync } = await import("node:fs");
    const composeFile = join(tmpDir, "docker-compose.yml");
    if (existsSync(composeFile)) unlinkSync(composeFile);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { cmdLogs } = await import("../../src/commands/logs.js");
    await expect(cmdLogs({ runtime: undefined })).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
    errSpy.mockRestore();

    // Restore file for other tests
    writeFileSync(composeFile, "services: {}");
  });

  it("tails all logs", async () => {
    const { execa } = await import("execa");
    const { cmdLogs } = await import("../../src/commands/logs.js");
    await cmdLogs({ runtime: undefined });

    // Verify execa was called with logs -f
    expect(execa).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["logs", "-f"]),
      expect.anything(),
    );
  });

  it("tails specific service logs", async () => {
    const { execa } = await import("execa");
    const { cmdLogs } = await import("../../src/commands/logs.js");
    await cmdLogs({ runtime: undefined }, "api");

    expect(execa).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["logs", "-f", "api"]),
      expect.anything(),
    );
  });
});
