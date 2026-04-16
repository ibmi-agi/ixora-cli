import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SAMPLE_ENV,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

// We need to mock the constants to point to our temp dir
vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "ixora-cfg-test-"));
  return {
    ...actual,
    IXORA_DIR: tmpDir,
    ENV_FILE: join(tmpDir, ".env"),
    COMPOSE_FILE: join(tmpDir, "docker-compose.yml"),
    SYSTEMS_CONFIG: join(tmpDir, "ixora-systems.yaml"),
  };
});

describe("config commands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let ENV_FILE: string;
  let SYSTEMS_CONFIG: string;

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
    SYSTEMS_CONFIG = constants.SYSTEMS_CONFIG;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("cmdConfigShow", () => {
    it("displays model + per-system IBM i credentials with masked secrets", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML_SINGLE);
      const { cmdConfigShow } = await import("../../src/commands/config.js");
      cmdConfigShow();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("IXORA_AGENT_MODEL");
      expect(output).toContain("IBM i Systems");
      // Per-system entry rendered from ixora-systems.yaml + SYSTEM_DEFAULT_*
      expect(output).toContain("default");
      expect(output).toContain("myibmi.example.com");
      // Password is masked, never raw
      expect(output).not.toContain("secret123");
      expect(output).toContain("IXORA_PROFILE");
      // IXORA_API_PORT is always shown (even at default) so users discover it
      expect(output).toContain("IXORA_API_PORT");
      expect(output).toContain("8000");
      // Legacy DB2i_* block is gone from the canonical display
      expect(output).not.toContain("DB2i_HOST");
    });

    it("reflects a custom IXORA_API_PORT under Deployment", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV + "IXORA_API_PORT='9000'\n");
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML_SINGLE);
      const { cmdConfigShow } = await import("../../src/commands/config.js");
      cmdConfigShow();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("IXORA_API_PORT");
      expect(output).toContain("9000");
      // Should not double-print under "Other"
      const otherIdx = output.indexOf("Other");
      if (otherIdx >= 0) {
        expect(output.slice(otherIdx)).not.toContain("IXORA_API_PORT");
      }
    });

    it("shows a 'no systems configured' hint when ixora-systems.yaml is empty", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      // No SYSTEMS_CONFIG file written — simulate a partial install
      try {
        rmSync(SYSTEMS_CONFIG, { force: true });
      } catch {
        // not there, fine
      }
      const { cmdConfigShow } = await import("../../src/commands/config.js");
      cmdConfigShow();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("IBM i Systems");
      expect(output).toContain("no systems configured");
    });
  });

  describe("cmdConfigSet", () => {
    it("updates a key in the env file", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { cmdConfigSet } = await import("../../src/commands/config.js");
      cmdConfigSet("IXORA_PROFILE", "security");

      const content = readFileSync(ENV_FILE, "utf-8");
      expect(content).toContain("IXORA_PROFILE='security'");
    });
  });
});
