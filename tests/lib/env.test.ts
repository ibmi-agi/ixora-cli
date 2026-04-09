import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  envGet,
  writeEnvFile,
  updateEnvKey,
  type EnvConfig,
} from "../../src/lib/env.js";
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
      expect(envGet("DB2i_HOST", envFile)).toBe("myibmi.example.com");
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
        db2Host: "ibmi.local",
        db2User: "ADMIN",
        db2Pass: "pass123",
        db2Port: "8076",
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
      expect(content).toContain("DB2i_HOST='ibmi.local'");
      expect(content).toContain("DB2i_USER='ADMIN'");
      expect(content).toContain("DB2i_PASS='pass123'");
      expect(content).toContain("IXORA_PROFILE='full'");
      expect(content).toContain("IXORA_VERSION='latest'");
    });

    it("writes ollama host when provided", () => {
      const config: EnvConfig = {
        agentModel: "ollama:llama3.1",
        teamModel: "ollama:llama3.1",
        ollamaHost: "http://localhost:11434",
        db2Host: "ibmi.local",
        db2User: "ADMIN",
        db2Pass: "pass",
        db2Port: "8076",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("OLLAMA_HOST='http://localhost:11434'");
    });

    it("preserves extra user keys", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_EXTRAS);

      const config: EnvConfig = {
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        db2Host: "new-host.com",
        db2User: "USER2",
        db2Pass: "newpass",
        db2Port: "8076",
        profile: "security",
        version: "v1.0.0",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");

      expect(content).toContain("CUSTOM_VAR='custom_value'");
      expect(content).toContain("RAG_API_URL='http://rag.example.com'");
      expect(content).toContain("DB2i_HOST='new-host.com'");
    });

    it("does not wipe DB2_PORT as an unknown key", () => {
      writeFileSync(envFile, SAMPLE_ENV + "DB2_PORT='9876'\n");

      const config: EnvConfig = {
        agentModel: "anthropic:claude-sonnet-4-6",
        teamModel: "anthropic:claude-haiku-4-5",
        db2Host: "host",
        db2User: "user",
        db2Pass: "pass",
        db2Port: "8076",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");
      // DB2_PORT is a known key, so it should not appear in preserved user settings
      // (it would only appear there if it were NOT in KNOWN_KEYS)
      expect(content).not.toContain("Preserved user settings");
    });

    it("escapes single quotes in values", () => {
      const config: EnvConfig = {
        agentModel: "test",
        teamModel: "test",
        db2Host: "host",
        db2User: "user",
        db2Pass: "pass'with'quotes",
        db2Port: "8076",
        profile: "full",
        version: "latest",
      };

      writeEnvFile(config, envFile);
      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("pass'\\''with'\\''quotes");
    });

    it("sets file permissions to 600", () => {
      const config: EnvConfig = {
        agentModel: "test",
        teamModel: "test",
        db2Host: "h",
        db2User: "u",
        db2Pass: "p",
        db2Port: "8076",
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

      expect(envGet("DB2i_HOST", envFile)).toBe("myibmi.example.com");
      expect(envGet("IXORA_VERSION", envFile)).toBe("latest");
    });

    it("escapes single quotes in values", () => {
      writeFileSync(envFile, "KEY='old'\n");
      updateEnvKey("KEY", "new'val", envFile);

      const content = readFileSync(envFile, "utf-8");
      expect(content).toContain("new'\\''val");
    });
  });
});
