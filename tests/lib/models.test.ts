import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "ixora-models-lib-test-"));
  return {
    ...actual,
    IXORA_DIR: tmpDir,
    ENV_FILE: join(tmpDir, ".env"),
    COMPOSE_FILE: join(tmpDir, "docker-compose.yml"),
    SYSTEMS_CONFIG: join(tmpDir, "ixora-systems.yaml"),
  };
});

describe("models lib", () => {
  let ENV_FILE: string;

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
  });

  describe("detectCurrentProvider", () => {
    it("returns anthropic for anthropic model", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { detectCurrentProvider } = await import(
        "../../src/lib/models.js"
      );
      expect(detectCurrentProvider()).toBe("anthropic");
    });

    it("returns google for google model", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV.replace(
          "IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'",
          "IXORA_AGENT_MODEL='google:gemini-2.5-pro'",
        ),
      );
      const { detectCurrentProvider } = await import(
        "../../src/lib/models.js"
      );
      expect(detectCurrentProvider()).toBe("google");
    });

    it("returns openai for openai model", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV.replace(
          "IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'",
          "IXORA_AGENT_MODEL='openai:gpt-4o'",
        ),
      );
      const { detectCurrentProvider } = await import(
        "../../src/lib/models.js"
      );
      expect(detectCurrentProvider()).toBe("openai");
    });

    it("returns openai-compatible when sentinel is set", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV +
          "IXORA_MODEL_PROVIDER='openai-compatible'\n" +
          "IXORA_OPENAI_BASE_URL='http://localhost:8000/v1'\n",
      );
      const { detectCurrentProvider } = await import(
        "../../src/lib/models.js"
      );
      expect(detectCurrentProvider()).toBe("openai-compatible");
    });

    it("returns ollama for ollama model", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV.replace(
          "IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'",
          "IXORA_AGENT_MODEL='ollama:llama3.1'",
        ),
      );
      const { detectCurrentProvider } = await import(
        "../../src/lib/models.js"
      );
      expect(detectCurrentProvider()).toBe("ollama");
    });

    it("defaults to anthropic when no model is set", async () => {
      writeFileSync(ENV_FILE, "IXORA_PROFILE='full'\n");
      const { detectCurrentProvider } = await import(
        "../../src/lib/models.js"
      );
      expect(detectCurrentProvider()).toBe("anthropic");
    });
  });

  describe("applyModelConfig", () => {
    it("writes model keys to env file", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { applyModelConfig } = await import("../../src/lib/models.js");

      applyModelConfig({
        provider: "google",
        agentModel: "google:gemini-2.5-pro",
        teamModel: "google:gemini-2.5-flash",
        apiKeyVar: "GOOGLE_API_KEY",
        apiKeyValue: "test-google-key",
      });

      const content = readFileSync(ENV_FILE, "utf-8");
      expect(content).toContain("IXORA_AGENT_MODEL='google:gemini-2.5-pro'");
      expect(content).toContain("IXORA_TEAM_MODEL='google:gemini-2.5-flash'");
      expect(content).toContain("GOOGLE_API_KEY='test-google-key'");
    });

    it("clears ollama host when switching to a non-ollama provider", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV + "OLLAMA_HOST='http://localhost:11434'\n",
      );
      const { applyModelConfig } = await import("../../src/lib/models.js");

      applyModelConfig({
        provider: "anthropic",
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        apiKeyVar: "ANTHROPIC_API_KEY",
        apiKeyValue: "sk-ant-test",
      });

      const content = readFileSync(ENV_FILE, "utf-8");
      expect(content).not.toContain("OLLAMA_HOST");
    });

    it("clears openai-compatible keys when switching away", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV +
          "IXORA_OPENAI_BASE_URL='http://localhost:8000/v1'\n" +
          "IXORA_MODEL_PROVIDER='openai-compatible'\n",
      );
      const { applyModelConfig } = await import("../../src/lib/models.js");

      applyModelConfig({
        provider: "google",
        agentModel: "google:gemini-2.5-pro",
        teamModel: "google:gemini-2.5-flash",
        apiKeyVar: "GOOGLE_API_KEY",
        apiKeyValue: "test-key",
      });

      const content = readFileSync(ENV_FILE, "utf-8");
      expect(content).not.toContain("IXORA_OPENAI_BASE_URL");
      expect(content).not.toContain("IXORA_MODEL_PROVIDER");
    });

    it("preserves existing env keys not related to models", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { applyModelConfig } = await import("../../src/lib/models.js");

      applyModelConfig({
        provider: "google",
        agentModel: "google:gemini-2.5-pro",
        teamModel: "google:gemini-2.5-flash",
        apiKeyVar: "GOOGLE_API_KEY",
        apiKeyValue: "test-key",
      });

      const content = readFileSync(ENV_FILE, "utf-8");
      // Original non-model keys preserved
      expect(content).toContain("IXORA_PROFILE='full'");
      expect(content).toContain("IXORA_VERSION='latest'");
      expect(content).toContain("SYSTEM_DEFAULT_HOST='myibmi.example.com'");
    });
  });
});
