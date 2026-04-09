import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-stop-"));

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
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

describe("stop command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("requires compose file", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { cmdStop } = await import("../../src/commands/stop.js");
    await expect(cmdStop({ runtime: undefined })).rejects.toThrow(
      "process.exit",
    );

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("stops services successfully", async () => {
    writeFileSync(join(tmpDir, "docker-compose.yml"), "services: {}");

    const { cmdStop } = await import("../../src/commands/stop.js");
    await cmdStop({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Services stopped");
  });
});
