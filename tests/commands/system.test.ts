import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV, SAMPLE_SYSTEMS_YAML } from "../helpers/fixtures.js";

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/constants.js")>("../../src/lib/constants.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "ixora-sys-cmd-"));
  return {
    ...actual,
    IXORA_DIR: tmpDir,
    ENV_FILE: join(tmpDir, ".env"),
    COMPOSE_FILE: join(tmpDir, "docker-compose.yml"),
    SYSTEMS_CONFIG: join(tmpDir, "ixora-systems.yaml"),
  };
});

describe("system commands", () => {
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

  describe("cmdSystemList", () => {
    it("shows primary system", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      const { cmdSystemList } = await import("../../src/commands/system.js");
      cmdSystemList();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("IBM i Systems");
      expect(output).toContain("default");
      expect(output).toContain("myibmi.example.com");
    });

    it("shows additional systems", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML);
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV +
          "SYSTEM_DEV_HOST='dev.ibmi.com'\nSYSTEM_PROD_HOST='prod.ibmi.com'\n",
      );

      const { cmdSystemList } = await import("../../src/commands/system.js");
      cmdSystemList();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("dev");
      expect(output).toContain("prod");
    });

    it("shows empty message when no systems", async () => {
      writeFileSync(ENV_FILE, "IXORA_PROFILE='full'\n");
      // Remove systems config if it exists from prior test
      const { existsSync, unlinkSync } = await import("node:fs");
      if (existsSync(SYSTEMS_CONFIG)) unlinkSync(SYSTEMS_CONFIG);

      const { cmdSystemList } = await import("../../src/commands/system.js");
      cmdSystemList();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No systems configured");
    });
  });

  describe("cmdSystemRemove", () => {
    it("removes a system", async () => {
      writeFileSync(ENV_FILE, "SYSTEM_DEV_HOST='h'\n");
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML);

      const { cmdSystemRemove } = await import("../../src/commands/system.js");
      cmdSystemRemove("dev");

      // Verify success message was logged
      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Removed system");
    });
  });
});
