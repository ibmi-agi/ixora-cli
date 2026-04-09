import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

// We need to mock the constants to point to our temp dir
vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/constants.js")>("../../src/lib/constants.js");
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

  beforeEach(async () => {
    const constants = await import("../../src/lib/constants.js");
    ENV_FILE = constants.ENV_FILE;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("cmdConfigShow", () => {
    it("displays config with masked secrets", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { cmdConfigShow } = await import("../../src/commands/config.js");
      cmdConfigShow();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("IXORA_AGENT_MODEL");
      expect(output).toContain("DB2i_HOST");
      expect(output).toContain("IXORA_PROFILE");
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
