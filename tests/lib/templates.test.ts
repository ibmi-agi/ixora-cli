import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSingleCompose } from "../../src/lib/templates/single-compose.js";
import { generateMultiCompose } from "../../src/lib/templates/multi-compose.js";
import { SAMPLE_ENV, SAMPLE_SYSTEMS_YAML } from "../helpers/fixtures.js";

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

  describe("generateSingleCompose", () => {
    it("includes all four services", () => {
      const content = generateSingleCompose();
      expect(content).toContain("agentos-db:");
      expect(content).toContain("ibmi-mcp-server:");
      expect(content).toContain("api:");
      expect(content).toContain("ui:");
    });

    it("includes volume definitions", () => {
      const content = generateSingleCompose();
      expect(content).toContain("pgdata:");
      expect(content).toContain("agentos-data:");
    });

    it("includes depends_on with health conditions", () => {
      const content = generateSingleCompose();
      expect(content).toContain("condition: service_healthy");
    });
  });

  describe("generateMultiCompose", () => {
    it("generates per-system MCP and API services", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);

      // Primary system
      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");

      // Additional systems
      expect(content).toContain("mcp-dev:");
      expect(content).toContain("api-dev:");
      expect(content).toContain("mcp-prod:");
      expect(content).toContain("api-prod:");
    });

    it("assigns sequential ports starting at 8000", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);

      // Primary gets 8000, dev gets 8001, prod gets 8002
      expect(content).toContain('"8000:8000"');
      expect(content).toContain('"8001:8000"');
      expect(content).toContain('"8002:8000"');
    });

    it("includes shared DB service", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("agentos-db:");
    });

    it("includes UI pointing to first API", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("ui:");
      expect(content).toContain("api-default:");
    });

    it("uses system-specific env vars for credentials", () => {
      writeFileSync(envFile, SAMPLE_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("${SYSTEM_DEV_HOST}");
      expect(content).toContain("${SYSTEM_PROD_HOST}");
    });

    it("works without primary system", () => {
      writeFileSync(envFile, "IXORA_PROFILE='full'\nIXORA_VERSION='v1.0'\n");
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).not.toContain("mcp-default:");
      expect(content).toContain("mcp-dev:");
      expect(content).toContain("mcp-prod:");
    });
  });
});
