import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeVersion } from "../../src/lib/registry.js";

describe("registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("normalizeVersion", () => {
    it("adds v prefix when missing", () => {
      expect(normalizeVersion("0.0.11")).toBe("v0.0.11");
    });

    it("keeps v prefix when present", () => {
      expect(normalizeVersion("v0.0.11")).toBe("v0.0.11");
    });

    it("trims whitespace", () => {
      expect(normalizeVersion("  v1.0.0  ")).toBe("v1.0.0");
    });
  });
});
