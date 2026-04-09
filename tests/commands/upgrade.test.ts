import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV, SAMPLE_SYSTEMS_YAML_SINGLE } from "../helpers/fixtures.js";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-upgrade-"));

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

vi.mock("../../src/lib/registry.js", () => ({
  fetchImageTags: vi.fn().mockResolvedValue(["v0.0.11", "v0.0.10", "v0.0.9"]),
  normalizeVersion: vi.fn((v: string) => (v.startsWith("v") ? v : `v${v}`)),
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn().mockResolvedValue("v0.0.11"),
  input: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
}));

describe("upgrade command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let ENV_FILE: string;

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(ENV_FILE, SAMPLE_ENV);
    writeFileSync(
      join(tmpDir, "ixora-systems.yaml"),
      SAMPLE_SYSTEMS_YAML_SINGLE,
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("upgrades successfully with interactive version select", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Upgrade complete");

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_VERSION='v0.0.11'");
  });

  it("pins version with explicit arg", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, version: "v2.0.0" });

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_VERSION='v2.0.0'");

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("v2.0.0");
  });

  it("strips v prefix and normalizes version arg", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, version: "0.0.10" });

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_VERSION='v0.0.10'");
  });

  it("imageVersion flag works as override", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, imageVersion: "v2.0.0" });

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_VERSION='v2.0.0'");
  });

  it("updates profile when specified", async () => {
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({
      runtime: undefined,
      version: "v0.0.10",
      profile: "security",
    });

    const content = readFileSync(ENV_FILE, "utf-8");
    expect(content).toContain("IXORA_PROFILE='security'");
  });

  it("skips pull when --no-pull", async () => {
    const { execa } = await import("execa");
    const { cmdUpgrade } = await import("../../src/commands/upgrade.js");
    await cmdUpgrade({ runtime: undefined, version: "v0.0.10", pull: false });

    const calls = (execa as any).mock.calls;
    const pullCalls = calls.filter((c: any[]) => c[1]?.includes("pull"));
    expect(pullCalls).toHaveLength(0);
  });
});
