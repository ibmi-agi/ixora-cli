import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-upgrade-"));

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

vi.mock("../../src/lib/health.js", () => ({
  waitForHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

describe("upgrade command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let ENV_FILE: string;

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(ENV_FILE, SAMPLE_ENV);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("upgrades successfully", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Upgrade complete");
  });

  it("pins version when specified", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, imageVersion: "v2.0.0" });

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_VERSION='v2.0.0'");
  });

  it("updates profile when specified", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, profile: "security" });

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_PROFILE='security'");
  });

  it("skips pull when --no-pull", async () => {
    const { execa } = await import("execa");
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, pull: false });

    // Should not have called pull
    const calls = (execa as any).mock.calls;
    const pullCalls = calls.filter((c: any[]) =>
      c[1]?.includes("pull"),
    );
    expect(pullCalls).toHaveLength(0);
  });
});
