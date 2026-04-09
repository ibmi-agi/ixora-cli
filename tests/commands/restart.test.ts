import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_SYSTEMS_YAML_SINGLE } from "../helpers/fixtures.js";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-restart-"));

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

vi.mock("../../src/lib/health.js", () => ({
  waitForHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

describe("restart command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(
      join(tmpDir, ".env"),
      "DB2i_HOST='test'\nIXORA_VERSION='latest'\nSYSTEM_DEFAULT_HOST='test'\nSYSTEM_DEFAULT_USER='user'\nSYSTEM_DEFAULT_PASS='pass'\n",
    );
    writeFileSync(
      join(tmpDir, "ixora-systems.yaml"),
      SAMPLE_SYSTEMS_YAML_SINGLE,
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("restarts all services", async () => {
    const { cmdRestart } = await import("../../src/commands/restart.js");
    await cmdRestart({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("All services restarted");
  });

  it("restarts a specific service", async () => {
    const { cmdRestart } = await import("../../src/commands/restart.js");
    await cmdRestart({ runtime: undefined }, "api");

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Restarted api");
  });

  it("resolves container names to service names", async () => {
    const { cmdRestart } = await import("../../src/commands/restart.js");
    await cmdRestart({ runtime: undefined }, "ixora-api-1");

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Restarted api");
  });
});
