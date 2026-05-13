import { describe, it, expect } from "vitest";
import {
  SCRIPT_VERSION,
  HEALTH_TIMEOUT,
  IXORA_DIR,
  COMPOSE_FILE,
  SYSTEMS_CONFIG,
  ENV_FILE,
  DEPLOYMENT_MODES,
  STACK_PROFILES,
  VALID_STACK_PROFILES,
  DB_ISOLATION_MODES,
  DEFAULT_DB_ISOLATION,
  PROVIDERS,
} from "../../src/lib/constants.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(
    join(fileURLToPath(import.meta.url), "..", "..", "..", "package.json"),
    "utf8",
  ),
) as { version: string };

describe("constants", () => {
  it("matches the version in package.json", () => {
    expect(SCRIPT_VERSION).toBe(pkg.version);
  });

  it("has correct health timeout", () => {
    expect(HEALTH_TIMEOUT).toBe(30);
  });

  it("sets correct paths under ~/.ixora", () => {
    const expected = join(homedir(), ".ixora");
    expect(IXORA_DIR).toBe(expected);
    expect(COMPOSE_FILE).toBe(join(expected, "docker-compose.yml"));
    expect(SYSTEMS_CONFIG).toBe(join(expected, "ixora-systems.yaml"));
    expect(ENV_FILE).toBe(join(expected, ".env"));
  });

  it("defines the two deployment modes (full, custom)", () => {
    expect(DEPLOYMENT_MODES).toEqual(["full", "custom"]);
  });

  it("defines stack profiles full, mcp and cli", () => {
    expect(VALID_STACK_PROFILES).toEqual(["full", "mcp", "cli"]);
    for (const p of VALID_STACK_PROFILES) {
      expect(STACK_PROFILES[p]).toBeDefined();
      expect(STACK_PROFILES[p].name).toBe(p);
      expect(STACK_PROFILES[p].description).toBeTruthy();
    }
  });

  it("defines the db isolation modes, defaulting to per-system", () => {
    expect(DB_ISOLATION_MODES).toEqual(["per-system", "shared"]);
    expect(DEFAULT_DB_ISOLATION).toBe("per-system");
  });

  it("defines all providers", () => {
    const providerNames = ["anthropic", "openai", "google", "ollama", "custom"];
    for (const p of providerNames) {
      expect(PROVIDERS[p]).toBeDefined();
      expect(PROVIDERS[p].name).toBe(p);
    }
  });

  it("anthropic is the recommended provider", () => {
    expect(PROVIDERS["anthropic"].agentModel).toBe(
      "anthropic:claude-sonnet-4-6",
    );
    expect(PROVIDERS["anthropic"].teamModel).toBe("anthropic:claude-haiku-4-5");
  });

  it("ollama needs no API key", () => {
    expect(PROVIDERS["ollama"].apiKeyVar).toBe("");
  });

});
