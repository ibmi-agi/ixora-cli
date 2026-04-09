import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SAMPLE_ENV,
  SAMPLE_SYSTEMS_YAML,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-start-"));

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

describe("start command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let ENV_FILE: string;
  let COMPOSE_FILE: string;

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
    COMPOSE_FILE = constants.COMPOSE_FILE;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("requires installation", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { cmdStart } = await import("../../src/commands/start.js");

    await expect(cmdStart({ runtime: undefined })).rejects.toThrow(
      "process.exit",
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("not installed"),
    );

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("writes compose file and starts services", async () => {
    writeFileSync(ENV_FILE, SAMPLE_ENV);
    writeFileSync(
      join(tmpDir, "ixora-systems.yaml"),
      SAMPLE_SYSTEMS_YAML_SINGLE,
    );

    const { cmdStart } = await import("../../src/commands/start.js");
    await cmdStart({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("ixora is running");
    expect(output).toContain("http://localhost:3000");
    expect(output).toContain("http://localhost:8000");
  });

  it("shows multi-system info when multiple systems configured", async () => {
    writeFileSync(
      ENV_FILE,
      SAMPLE_ENV +
        "SYSTEM_DEV_HOST='dev.ibmi.com'\nSYSTEM_PROD_HOST='prod.ibmi.com'\n",
    );
    writeFileSync(join(tmpDir, "ixora-systems.yaml"), SAMPLE_SYSTEMS_YAML);

    const { cmdStart } = await import("../../src/commands/start.js");
    await cmdStart({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("ixora is running");
    expect(output).toContain("Systems:");
  });
});
