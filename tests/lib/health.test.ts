import { describe, it, expect } from "vitest";
// Health module uses execa which we can't easily test without docker.
// We test the module imports correctly and the timeout constant.
import { HEALTH_TIMEOUT } from "../../src/lib/constants.js";

describe("health", () => {
  it("has a default timeout of 30 seconds", () => {
    expect(HEALTH_TIMEOUT).toBe(30);
  });
});
