import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveService } from "../../src/lib/compose.js";
import { generateMultiCompose } from "../../src/lib/templates/multi-compose.js";
import {
  SAMPLE_ENV_WITH_SYSTEM,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

describe("compose", () => {
  describe("resolveService", () => {
    it("returns service name as-is", () => {
      expect(resolveService("api")).toBe("api");
    });

    it("strips ixora- prefix", () => {
      expect(resolveService("ixora-api")).toBe("api");
    });

    it("strips trailing replica number", () => {
      expect(resolveService("ixora-api-1")).toBe("api");
    });

    it("handles container name with just prefix", () => {
      expect(resolveService("ixora-ui-1")).toBe("ui");
    });

    it("preserves multi-part service names", () => {
      expect(resolveService("ibmi-mcp-server")).toBe("ibmi-mcp-server");
    });

    it("strips both prefix and suffix from full container name", () => {
      expect(resolveService("ixora-ibmi-mcp-server-1")).toBe("ibmi-mcp-server");
    });
  });

  describe("generateMultiCompose (single system)", () => {
    let tmpDir: string;
    let envFile: string;
    let configFile: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "ixora-compose-"));
      envFile = join(tmpDir, ".env");
      configFile = join(tmpDir, "ixora-systems.yaml");
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("generates valid compose with all services", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("services:");
      expect(content).toContain("agentos-db:");
      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");
      expect(content).toContain("ui:");
      expect(content).toContain("volumes:");
    });

    it("includes correct image references", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-mcp-server");
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-api");
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-ui");
    });

    it("includes correct port mappings", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("8000:8000");
      expect(content).toContain("3000:3000");
    });

    it("includes health checks", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("healthcheck:");
      expect(content).toContain("pg_isready");
      expect(content).toContain("healthz");
    });

    it("includes system-specific environment variable references", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("${IXORA_VERSION:-latest}");
    });
  });
});
