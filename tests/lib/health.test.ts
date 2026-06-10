import { describe, it, expect } from "vitest";
import { HEALTH_TIMEOUT } from "../../src/lib/constants.js";
import { findApiContainerName } from "../../src/lib/health.js";
import { DOCKER_PS_NDJSON, PODMAN_PS_JSON } from "../helpers/fixtures.js";

describe("health", () => {
  it("has a default timeout of 30 seconds", () => {
    expect(HEALTH_TIMEOUT).toBe(30);
  });

  describe("findApiContainerName", () => {
    it("finds the api container in docker compose v2 NDJSON", () => {
      expect(findApiContainerName(DOCKER_PS_NDJSON)).toBe(
        "ixora-api-default-1",
      );
    });

    it("finds the api container in podman-compose ps JSON", () => {
      expect(findApiContainerName(PODMAN_PS_JSON)).toBe("ixora_api-default_1");
    });

    it("targets a specific api service when given", () => {
      const out = JSON.stringify([
        { Name: "ixora-api-default-1", Service: "api-default", State: "running" },
        { Name: "ixora-api-dev-1", Service: "api-dev", State: "running" },
      ]);
      expect(findApiContainerName(out, "api-dev")).toBe("ixora-api-dev-1");
    });

    it("returns empty string when no api container exists", () => {
      const out = JSON.stringify([
        { Name: "ixora-ui-1", Service: "ui", State: "running" },
      ]);
      expect(findApiContainerName(out)).toBe("");
      expect(findApiContainerName("")).toBe("");
    });
  });
});
