import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseDir = mkdtempSync(join(tmpdir(), "ixora-install-oai-compat-"));
const tmpDir = join(baseDir, "ixora");

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
  fetchImageTags: vi.fn().mockResolvedValue(["v0.0.11", "v0.0.10"]),
  normalizeVersion: vi.fn((v: string) => (v.startsWith("v") ? v : `v${v}`)),
}));

// Prompt chain for openai-compatible flow:
//   select:   provider ("openai-compatible") -> profile ("full") -> image version
//   input:    baseUrl -> modelName -> host -> user -> port -> displayName
//   password: api key ("" — exercises optional carve-out) -> ibmi password
vi.mock("@inquirer/prompts", () => ({
  select: vi
    .fn()
    .mockResolvedValueOnce("openai-compatible")
    .mockResolvedValueOnce("full")
    .mockResolvedValueOnce("v0.0.11"),
  input: vi
    .fn()
    .mockResolvedValueOnce("http://host.docker.internal:8000/v1")
    .mockResolvedValueOnce("llama3.1")
    .mockResolvedValueOnce("myibmi.com")
    .mockResolvedValueOnce("QSECOFR")
    .mockResolvedValueOnce("8076")
    .mockResolvedValueOnce("myibmi.com"),
  password: vi
    .fn()
    .mockResolvedValueOnce("") // empty API key — optional for openai-compat
    .mockResolvedValueOnce("ibmi-password"),
  confirm: vi.fn().mockResolvedValue(true),
}));

describe("install command: openai-compatible provider", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Stub reachability probe — return a 200 so install prints "reachable"
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("writes scoped endpoint vars and probes host.docker.internal via localhost", async () => {
    const { cmdInstall } = await import("../../src/commands/install.js");
    await cmdInstall({ runtime: undefined });

    const envPath = join(tmpDir, ".env");
    expect(existsSync(envPath)).toBe(true);

    const envContent = readFileSync(envPath, "utf-8");
    expect(envContent).toContain("IXORA_AGENT_MODEL='openai:llama3.1'");
    expect(envContent).toContain("IXORA_TEAM_MODEL='openai:llama3.1'");
    expect(envContent).toContain(
      "IXORA_OPENAI_BASE_URL='http://host.docker.internal:8000/v1'",
    );
    expect(envContent).toContain("IXORA_MODEL_PROVIDER='openai-compatible'");
    // Empty API key should not be written
    expect(envContent).not.toContain("OPENAI_API_KEY=");

    // Probe should rewrite host.docker.internal -> localhost so the CLI
    // (running on the host) can actually reach the endpoint.
    const probeUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(probeUrls.some((u) => u === "http://localhost:8000/v1/models")).toBe(
      true,
    );
    expect(probeUrls.every((u) => !u.includes("host.docker.internal"))).toBe(
      true,
    );
  });
});
