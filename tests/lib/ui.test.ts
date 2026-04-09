import { describe, it, expect, vi, beforeEach } from "vitest";
import { maskValue, isSensitiveKey } from "../../src/lib/ui.js";

describe("ui", () => {
  describe("maskValue", () => {
    it("returns (not set) for undefined", () => {
      const result = maskValue(undefined);
      expect(result).toContain("not set");
    });

    it("returns (not set) for empty string", () => {
      const result = maskValue("");
      expect(result).toContain("not set");
    });

    it("returns **** for short values (<=4 chars)", () => {
      expect(maskValue("abc")).toBe("****");
      expect(maskValue("abcd")).toBe("****");
    });

    it("shows first 4 chars + **** for longer values", () => {
      expect(maskValue("sk-ant-12345")).toBe("sk-a****");
      expect(maskValue("hello-world")).toBe("hell****");
    });
  });

  describe("isSensitiveKey", () => {
    it("detects KEY in name", () => {
      expect(isSensitiveKey("ANTHROPIC_API_KEY")).toBe(true);
      expect(isSensitiveKey("api_key")).toBe(true);
    });

    it("detects TOKEN in name", () => {
      expect(isSensitiveKey("AUTH_TOKEN")).toBe(true);
    });

    it("detects PASS in name", () => {
      expect(isSensitiveKey("DB2i_PASS")).toBe(true);
      expect(isSensitiveKey("PASSWORD")).toBe(true);
    });

    it("detects SECRET in name", () => {
      expect(isSensitiveKey("CLIENT_SECRET")).toBe(true);
    });

    it("returns false for non-sensitive keys", () => {
      expect(isSensitiveKey("DB2i_HOST")).toBe(false);
      expect(isSensitiveKey("IXORA_PROFILE")).toBe(false);
      expect(isSensitiveKey("OLLAMA_HOST")).toBe(false);
    });
  });
});
