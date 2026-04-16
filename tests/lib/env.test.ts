import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  envGet,
  writeEnvFile,
  updateEnvKey,
  getApiPortBase,
  type EnvConfig,
} from "../../src/lib/env.js";
import { DEFAULT_API_PORT } from "../../src/lib/constants.js";
import { SAMPLE_ENV, SAMPLE_ENV_WITH_EXTRAS } from "../helpers/fixtures.js";

describe("env", () => {
  let tmpDir: string;
  let envFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ixora-test-"));
    envFile = join(tmpDir, ".env");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("envGet", () => {
    it("returns empty string for missing file", () => {
      expect(envGet("MISSING_KEY", envFile)).toBe("");
    });

    it("reads a simple key=value", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      expect(envGet("IXORA_PROFILE", envFile)).toBe("full");
    });

    it("reads single-quoted values", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      expect(envGet("SYSTEM_DEFAULT_HOST", envFile)).toBe(
        "myibmi.example.com",
      );
    });

    it("reads double-quoted values", () => {
      writeFileSync(envFile, `MY_KEY="hello world"\n`);
      expect(envGet("MY_KEY", envFile)).toBe("hello world");
    });

    it("returns empty string for missing key", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      expect(envGet("NONEXISTENT", envFile)).toBe("");
    });

    it("handles keys without quotes", () => {
      writeFileSync(envFile, "PLAIN=value123\n");
      expect(envGet("PLAIN", envFile)).toBe("value123");
    });

    it("does not match partial key names", () => {
      writeFileSync(envFile, "MY_KEY='val'\nMY_KEY_2='other'\n");
      expect(envGet("MY_KEY", envFile)).toBe("val");
    });
  });

  describe("writeEnvFile", () => {
    it("writes all config keys", () => {
      const config: EnvConfig = {
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        apiKeyVar: "ANTHROPIC_API_KEY",
        apiKeyValue: "sk-test",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");

      expect(content).toContain(
        "IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'",
      );
      expect(content).toContain(
        "IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'",
      );
      expect(content).toContain("ANTHROPIC_API_KEY='sk-test'");
      expect(content).toContain("IXORA_PROFILE='full'");
      expect(content).toContain("IXORA_VERSION='latest'");
      // IBM i credentials are written by addSystem() as SYSTEM_<ID>_*,
      // never by writeEnvFile. DB2i_* at the host .env level was dead
      // weight that duplicated the SYSTEM_DEFAULT_* block.
      expect(content).not.toContain("DB2i_HOST");
      expect(content).not.toContain("DB2i_USER");
      expect(content).not.toContain("DB2i_PASS");
      expect(content).not.toContain("DB2_PORT");
    });

    it("writes ollama host when provided", () => {
      const config: EnvConfig = {
        agentModel: "ollama:llama3.1",
        teamModel: "ollama:llama3.1",
        ollamaHost: "http://localhost:11434",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("OLLAMA_HOST='http://localhost:11434'");
    });

    it("writes openai base url and provider kind when provided", () => {
      const config: EnvConfig = {
        agentModel: "openai:llama3.1",
        teamModel: "openai:llama3.1",
        apiKeyVar: "OPENAI_API_KEY",
        apiKeyValue: "sk-test",
        openaiBaseUrl: "http://host.docker.internal:8000/v1",
        modelProviderKind: "openai-compatible",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain(
        "IXORA_OPENAI_BASE_URL='http://host.docker.internal:8000/v1'",
      );
      expect(content).toContain("IXORA_MODEL_PROVIDER='openai-compatible'");
      expect(content).toContain("IXORA_AGENT_MODEL='openai:llama3.1'");
    });

    it("drops openai base url and provider kind when omitted on reconfigure", () => {
      // Seed with openai-compatible config
      const initial: EnvConfig = {
        agentModel: "openai:llama3.1",
        teamModel: "openai:llama3.1",
        openaiBaseUrl: "http://host.docker.internal:8000/v1",
        modelProviderKind: "openai-compatible",
        profile: "full",
        version: "latest",
      };
      writeEnvFile(initial, envFile);

      // Reconfigure: switch to anthropic, omit openai-compat fields
      const next: EnvConfig = {
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        apiKeyVar: "ANTHROPIC_API_KEY",
        apiKeyValue: "sk-ant-test",
        profile: "full",
        version: "latest",
      };
      writeEnvFile(next, envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).not.toContain("IXORA_OPENAI_BASE_URL");
      expect(content).not.toContain("IXORA_MODEL_PROVIDER");
      expect(content).toContain(
        "IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'",
      );
    });

    it("preserves extra user keys", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_EXTRAS);

      const config: EnvConfig = {
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        profile: "security",
        version: "v1.0.0",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");

      expect(content).toContain("CUSTOM_VAR='custom_value'");
      expect(content).toContain("RAG_API_URL='http://rag.example.com'");
    });

    it("drops stale DB2i_* lines from a pre-migration .env", () => {
      // Seed a .env that looks like a pre-migration install: DB2i_* block
      // from the old writeEnvFile template plus the SYSTEM_DEFAULT_* block
      // that addSystem() has always written in parallel.
      writeFileSync(
        envFile,
        `IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
DB2i_HOST='stale.example.com'
DB2i_USER='STALE'
DB2i_PASS='stale-pass'
DB2_PORT='9876'
IXORA_PROFILE='full'
IXORA_VERSION='latest'
SYSTEM_DEFAULT_HOST='current.example.com'
SYSTEM_DEFAULT_USER='CURRENT'
SYSTEM_DEFAULT_PASS='current-pass'
SYSTEM_DEFAULT_PORT='8076'
`,
      );

      const config: EnvConfig = {
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        profile: "full",
        version: "latest",
      };
      writeEnvFile(config, envFile);

      const content = readFileSync(envFile, "utf-8");
      // DB2i_* remains in KNOWN_KEYS so the preserved-extras filter drops
      // the stale lines on rewrite — this is the migration lever.
      expect(content).not.toContain("DB2i_HOST");
      expect(content).not.toContain("DB2i_USER");
      expect(content).not.toContain("DB2i_PASS");
      expect(content).not.toContain("DB2_PORT");
      // SYSTEM_DEFAULT_* is an "extra" from writeEnvFile's perspective
      // (it's written by addSystem, not the template) so it is preserved.
      expect(content).toContain("SYSTEM_DEFAULT_HOST='current.example.com'");
      expect(content).toContain("SYSTEM_DEFAULT_USER='CURRENT'");
      expect(content).toContain("SYSTEM_DEFAULT_PASS='current-pass'");
      expect(content).toContain("SYSTEM_DEFAULT_PORT='8076'");
    });

    it("escapes single quotes in values", () => {
      const config: EnvConfig = {
        agentModel: "test",
        teamModel: "test",
        apiKeyVar: "ANTHROPIC_API_KEY",
        apiKeyValue: "key'with'quotes",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("key'\\''with'\\''quotes");
    });

    it("sets file permissions to 600", () => {
      const config: EnvConfig = {
        agentModel: "test",
        teamModel: "test",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const { statSync } = require("node:fs");
      const stats = statSync(envFile);
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe("updateEnvKey", () => {
    it("updates existing key in place", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      updateEnvKey("IXORA_PROFILE", "security", envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("IXORA_PROFILE='security'");
      expect(content).not.toContain("IXORA_PROFILE='full'");
    });

    it("appends new key", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      updateEnvKey("NEW_KEY", "new_value", envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("NEW_KEY='new_value'");
    });

    it("creates file if it does not exist", () => {
      const newFile = join(tmpDir, "subdir", ".env");
      updateEnvKey("MY_KEY", "my_value", newFile);

      const content = readFileSync(newFile, "utf-8");
      expect(content).toContain("MY_KEY='my_value'");
    });

    it("preserves other keys when updating", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      updateEnvKey("IXORA_PROFILE", "knowledge", envFile);

      expect(envGet("SYSTEM_DEFAULT_HOST", envFile)).toBe(
        "myibmi.example.com",
      );
      expect(envGet("IXORA_VERSION", envFile)).toBe("latest");
    });

    it("escapes single quotes in values", () => {
      writeFileSync(envFile, "KEY='old'\n");
      updateEnvKey("KEY", "new'val", envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("new'\\''val");
    });
  });

  describe("removeEnvKey", () => {
    it("removes a key from the env file", async () => {
      writeFileSync(envFile, SAMPLE_ENV + "OLLAMA_HOST='http://localhost:11434'\n");
      const { removeEnvKey } = await import("../../src/lib/env.js");
      removeEnvKey("OLLAMA_HOST", envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).not.toContain("OLLAMA_HOST");
      expect(content).toContain("IXORA_AGENT_MODEL");
      expect(content).toContain("IXORA_PROFILE");
    });

    it("does nothing when key does not exist", async () => {
      writeFileSync(envFile, SAMPLE_ENV);
      const { removeEnvKey } = await import("../../src/lib/env.js");
      removeEnvKey("NONEXISTENT_KEY", envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("IXORA_AGENT_MODEL");
    });

    it("does nothing when file does not exist", async () => {
      const { removeEnvKey } = await import("../../src/lib/env.js");
      removeEnvKey("SOME_KEY", join(tmpDir, "nonexistent", ".env"));
    });
  });

  describe("getApiPortBase", () => {
    it("returns DEFAULT_API_PORT when IXORA_API_PORT is unset", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      expect(getApiPortBase(envFile)).toBe(DEFAULT_API_PORT);
    });

    it("returns DEFAULT_API_PORT when env file is missing", () => {
      expect(getApiPortBase(join(tmpDir, "nonexistent", ".env"))).toBe(
        DEFAULT_API_PORT,
      );
    });

    it("returns the configured port when valid", () => {
      writeFileSync(envFile, SAMPLE_ENV + "IXORA_API_PORT='9000'\n");
      expect(getApiPortBase(envFile)).toBe(9000);
    });

    it("falls back to default and warns when value is non-numeric", () => {
      writeFileSync(envFile, SAMPLE_ENV + "IXORA_API_PORT='not-a-port'\n");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(getApiPortBase(envFile)).toBe(DEFAULT_API_PORT);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("falls back to default when value is below privileged-port boundary", () => {
      writeFileSync(envFile, SAMPLE_ENV + "IXORA_API_PORT='80'\n");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(getApiPortBase(envFile)).toBe(DEFAULT_API_PORT);
      warnSpy.mockRestore();
    });

    it("falls back to default when value exceeds 65535", () => {
      writeFileSync(envFile, SAMPLE_ENV + "IXORA_API_PORT='99999'\n");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(getApiPortBase(envFile)).toBe(DEFAULT_API_PORT);
      warnSpy.mockRestore();
    });
  });
});
