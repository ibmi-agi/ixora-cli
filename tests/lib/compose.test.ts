import { describe, it, expect } from "vitest";
import { resolveService } from "../../src/lib/compose.js";
import { generateSingleCompose } from "../../src/lib/templates/single-compose.js";

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
      expect(resolveService("ixora-ibmi-mcp-server-1")).toBe(
        "ibmi-mcp-server",
      );
    });
  });

  describe("generateSingleCompose", () => {
    it("generates valid compose with all services", () => {
      const content = generateSingleCompose();
      expect(content).toContain("services:");
      expect(content).toContain("agentos-db:");
      expect(content).toContain("ibmi-mcp-server:");
      expect(content).toContain("api:");
      expect(content).toContain("ui:");
      expect(content).toContain("volumes:");
    });

    it("includes correct image references", () => {
      const content = generateSingleCompose();
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-mcp-server");
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-api");
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-ui");
    });

    it("includes correct port mappings", () => {
      const content = generateSingleCompose();
      expect(content).toContain("3010:3010");
      expect(content).toContain("8000:8000");
      expect(content).toContain("3000:3000");
    });

    it("includes health checks", () => {
      const content = generateSingleCompose();
      expect(content).toContain("healthcheck:");
      expect(content).toContain("pg_isready");
      expect(content).toContain("healthz");
    });

    it("includes environment variable references", () => {
      const content = generateSingleCompose();
      expect(content).toContain("${DB2i_HOST}");
      expect(content).toContain("${IXORA_VERSION:-latest}");
      expect(content).toContain("${IXORA_PROFILE:-full}");
    });
  });
});
