import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectPlatform, getComposeParts, getRuntimeBin } from "../../src/lib/platform.js";

// We can't easily mock execa in ESM for detectComposeCmd, but we can test the pure functions

describe("platform", () => {
  describe("detectPlatform", () => {
    it("returns empty object for non-ppc64 arch", () => {
      // Default CI/dev machine is x64 or arm64
      const result = detectPlatform();
      // On non-ppc64, dbImage should be undefined
      if (process.arch !== "ppc64") {
        expect(result.dbImage).toBeUndefined();
      }
    });
  });

  describe("getComposeParts", () => {
    it("splits 'docker compose' correctly", () => {
      const [bin, args] = getComposeParts("docker compose");
      expect(bin).toBe("docker");
      expect(args).toEqual(["compose"]);
    });

    it("splits 'podman compose' correctly", () => {
      const [bin, args] = getComposeParts("podman compose");
      expect(bin).toBe("podman");
      expect(args).toEqual(["compose"]);
    });

    it("handles 'docker-compose' as single binary", () => {
      const [bin, args] = getComposeParts("docker-compose");
      expect(bin).toBe("docker-compose");
      expect(args).toEqual([]);
    });
  });

  describe("getRuntimeBin", () => {
    it("returns docker for docker compose", () => {
      expect(getRuntimeBin("docker compose")).toBe("docker");
    });

    it("returns docker for docker-compose", () => {
      expect(getRuntimeBin("docker-compose")).toBe("docker");
    });

    it("returns podman for podman compose", () => {
      expect(getRuntimeBin("podman compose")).toBe("podman");
    });
  });
});
