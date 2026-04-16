import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "ixora-models-cmd-test-"));
  return {
    ...actual,
    IXORA_DIR: tmpDir,
    ENV_FILE: join(tmpDir, ".env"),
    COMPOSE_FILE: join(tmpDir, "docker-compose.yml"),
    SYSTEMS_CONFIG: join(tmpDir, "ixora-systems.yaml"),
  };
});

describe("models commands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let ENV_FILE: string;

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("cmdModelsShow", () => {
    it("displays current model configuration", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { cmdModelsShow } = await import("../../src/commands/models.js");
      cmdModelsShow();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Model Configuration");
      expect(output).toContain("anthropic");
      expect(output).toContain("anthropic:claude-sonnet-4-6");
      expect(output).toContain("anthropic:claude-haiku-4-5");
      // API key is masked
      expect(output).not.toContain("sk-ant-api03-test1234567890");
      expect(output).toContain("sk-a****");
      // Available providers section
      expect(output).toContain("Available Providers");
      expect(output).toContain("Anthropic");
      expect(output).toContain("OpenAI");
      expect(output).toContain("Google");
      expect(output).toContain("Ollama");
    });

    it("shows openai-compatible details when configured", async () => {
      writeFileSync(
        ENV_FILE,
        `IXORA_AGENT_MODEL='openai:my-model'
IXORA_TEAM_MODEL='openai:my-model'
IXORA_MODEL_PROVIDER='openai-compatible'
IXORA_OPENAI_BASE_URL='http://localhost:8000/v1'
OPENAI_API_KEY='sk-test'
IXORA_PROFILE='full'
IXORA_VERSION='latest'
`,
      );
      const { cmdModelsShow } = await import("../../src/commands/models.js");
      cmdModelsShow();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("openai-compatible");
      expect(output).toContain("http://localhost:8000/v1");
    });

    it("exits when not installed", async () => {
      // Remove ENV_FILE left by prior tests to simulate not installed
      rmSync(ENV_FILE, { force: true });
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { cmdModelsShow } = await import("../../src/commands/models.js");
      expect(() => cmdModelsShow()).toThrow("process.exit");

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("cmdModelsSet", () => {
    it("rejects unknown provider names", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { cmdModelsSet } = await import("../../src/commands/models.js");
      await expect(cmdModelsSet("invalid-provider")).rejects.toThrow(
        "process.exit",
      );

      const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(errorOutput).toContain("Unknown provider");

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
