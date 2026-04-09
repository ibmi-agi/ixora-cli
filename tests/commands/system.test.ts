import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SAMPLE_ENV,
  SAMPLE_SYSTEMS_YAML,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
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
    it("shows systems from YAML", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML_SINGLE);
      const { cmdSystemList } = await import("../../src/commands/system.js");
      cmdSystemList();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("IBM i Systems");
      expect(output).toContain("default");
    });

    it("shows multiple systems", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV);
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML);

      const { cmdSystemList } = await import("../../src/commands/system.js");
      cmdSystemList();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("default");
      expect(output).toContain("dev");
      expect(output).toContain("prod");
    });

    it("shows empty message when no systems", async () => {
      writeFileSync(ENV_FILE, "IXORA_PROFILE='full'\n");
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

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Removed system");
    });
  });
});
