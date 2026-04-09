import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateMultiCompose } from "../../src/lib/templates/multi-compose.js";
import {
  SAMPLE_ENV_WITH_SYSTEM,
  SAMPLE_SYSTEMS_YAML,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

describe("templates", () => {
  let tmpDir: string;
  let envFile: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ixora-tmpl-"));
    envFile = join(tmpDir, ".env");
    configFile = join(tmpDir, "ixora-systems.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateMultiCompose", () => {
    it("generates per-system MCP and API services", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);

      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");
      expect(content).toContain("mcp-dev:");
      expect(content).toContain("api-dev:");
      expect(content).toContain("mcp-prod:");
      expect(content).toContain("api-prod:");
    });

    it("assigns sequential ports starting at 8000", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);

      expect(content).toContain('"8000:8000"');
      expect(content).toContain('"8001:8000"');
      expect(content).toContain('"8002:8000"');
    });

    it("includes shared DB service", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("agentos-db:");
    });

    it("includes UI pointing to first API", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("ui:");
      expect(content).toContain("api-default:");
    });

    it("uses system-specific env vars for credentials", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("${SYSTEM_DEV_HOST}");
      expect(content).toContain("${SYSTEM_PROD_HOST}");
    });

    it("includes MCP pool query timeout", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain('MCP_POOL_QUERY_TIMEOUT_MS: "120000"');
    });

    it("includes agent builder env vars with system-specific credentials", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain('IXORA_ENABLE_BUILDER: "true"');
      expect(content).toContain("DB2i_HOST: ${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("DB2i_HOST: ${SYSTEM_DEV_HOST}");
      expect(content).toContain("DB2i_HOST: ${SYSTEM_PROD_HOST}");
    });

    it("includes user_tools bind mount", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("source: ${HOME}/.ixora/user_tools");
      expect(content).toContain("target: /data/user_tools");
      expect(content).toContain("create_host_path: true");
    });

    it("includes IXORA_SYSTEM_NAME and IXORA_SYSTEM_ID", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("IXORA_SYSTEM_ID: default");
      expect(content).toContain("IXORA_SYSTEM_NAME: myibmi.example.com");
      expect(content).toContain("IXORA_SYSTEM_ID: dev");
      expect(content).toContain("IXORA_SYSTEM_NAME: Development");
    });

    it("uses per-system profile for deployment config", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("app/config/deployments/full.yaml");
      expect(content).toContain("app/config/deployments/security.yaml");
    });

    it("works with a single system in YAML", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");
      expect(content).toContain("ui:");
      expect(content).toContain('"8000:8000"');
      expect(content).not.toContain('"8001:8000"');
    });
  });
});
