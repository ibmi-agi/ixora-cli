import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-status-"));

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

describe("status command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows profile, version, and config dir", async () => {
    writeFileSync(join(tmpDir, ".env"), SAMPLE_ENV);
    writeFileSync(join(tmpDir, "docker-compose.yml"), "services: {}");

    const { cmdStatus } = await import("../../src/commands/status.js");
    await cmdStatus({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("full");
    expect(output).toContain("latest");
    expect(output).toContain(tmpDir);
  });

  it("requires compose file", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Remove compose file if exists
    const { existsSync, unlinkSync } = await import("node:fs");
    const composeFile = join(tmpDir, "docker-compose.yml");
    if (existsSync(composeFile)) unlinkSync(composeFile);

    const { cmdStatus } = await import("../../src/commands/status.js");
    await expect(cmdStatus({ runtime: undefined })).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
