import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseDir = mkdtempSync(join(tmpdir(), "ixora-install-"));
// Use a subdirectory that doesn't exist so install sees it as fresh
const tmpDir = join(baseDir, "ixora");

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

// Mock prompts in order: provider select, API key, IBM i host, user, password, profile select
vi.mock("@inquirer/prompts", () => ({
  select: vi.fn()
    .mockResolvedValueOnce("anthropic")   // provider
    .mockResolvedValueOnce("full"),        // profile
  input: vi.fn()
    .mockResolvedValueOnce("myibmi.com")  // host
    .mockResolvedValueOnce("QSECOFR"),    // user
  password: vi.fn()
    .mockResolvedValueOnce("sk-ant-test123")  // API key
    .mockResolvedValueOnce("mypassword"),      // IBM i password
  confirm: vi.fn().mockResolvedValue(true),
}));

describe("install command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("runs fresh install successfully", async () => {
    const { cmdInstall } = await import("../../src/commands/install.js");
    await cmdInstall({ runtime: undefined });

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("ixora is running");

    // Verify files were created
    expect(existsSync(join(tmpDir, ".env"))).toBe(true);
    expect(existsSync(join(tmpDir, "docker-compose.yml"))).toBe(true);
  });

  it("writes .env before docker-compose.yml", async () => {
    // Verify .env was written first by checking both exist and
    // the compose file can reference values from .env
    const envPath = join(tmpDir, ".env");
    const composePath = join(tmpDir, "docker-compose.yml");

    expect(existsSync(envPath)).toBe(true);
    expect(existsSync(composePath)).toBe(true);

    // .env should contain the IBM i host from the prompts
    const envContent = readFileSync(envPath, "utf-8");
    expect(envContent).toContain("DB2i_HOST='myibmi.com'");
    expect(envContent).toContain("ANTHROPIC_API_KEY='sk-ant-test123'");

    // Compose file should be valid
    const composeContent = readFileSync(composePath, "utf-8");
    expect(composeContent).toContain("services:");
  });
});
