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

const writeComposeFileMock = vi.fn();
vi.mock("../../src/lib/compose.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/compose.js")>(
    "../../src/lib/compose.js",
  );
  return {
    ...actual,
    writeComposeFile: writeComposeFileMock,
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
      expect(output).toContain("Systems");
      expect(output).toContain("default");
      // Heading row plus a managed row with computed local URL.
      expect(output).toContain("KIND");
      expect(output).toContain("managed");
      expect(output).toContain("http://localhost:18000");
    });

    it("shows external entries with their URL and kind", async () => {
      writeFileSync(ENV_FILE, "IXORA_PROFILE='full'\n");
      writeFileSync(
        SYSTEMS_CONFIG,
        `systems:
  - id: cloud
    name: 'Cloud AgentOS'
    kind: external
    url: 'https://agentos.example.com'
`,
      );

      const { cmdSystemList } = await import("../../src/commands/system.js");
      cmdSystemList();

      const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("cloud");
      expect(output).toContain("external");
      expect(output).toContain("https://agentos.example.com");
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

    it("regenerates compose file when a managed system is removed", async () => {
      writeFileSync(ENV_FILE, "SYSTEM_DEV_HOST='h'\n");
      writeFileSync(SYSTEMS_CONFIG, SAMPLE_SYSTEMS_YAML);
      writeComposeFileMock.mockClear();

      const { cmdSystemRemove } = await import("../../src/commands/system.js");
      cmdSystemRemove("dev");

      expect(writeComposeFileMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT regenerate compose file when an external system is removed", async () => {
      writeFileSync(ENV_FILE, "SYSTEM_CLOUD_AGENTOS_KEY='k'\n");
      writeFileSync(
        SYSTEMS_CONFIG,
        `systems:
  - id: cloud
    name: 'Cloud'
    kind: external
    url: 'https://agentos.example.com'
`,
      );
      writeComposeFileMock.mockClear();

      const { cmdSystemRemove } = await import("../../src/commands/system.js");
      cmdSystemRemove("cloud");

      expect(writeComposeFileMock).not.toHaveBeenCalled();
    });
  });

  describe("assertManaged (lifecycle guard)", () => {
    it("exits non-zero with hint when run against an external system", async () => {
      writeFileSync(ENV_FILE, "IXORA_PROFILE='full'\n");
      writeFileSync(
        SYSTEMS_CONFIG,
        `systems:
  - id: cloud
    name: 'Cloud'
    kind: external
    url: 'https://agentos.example.com'
`,
      );

      const { assertManaged } = await import("../../src/commands/system.js");
      const sys = {
        id: "cloud",
        name: "Cloud",
        kind: "external" as const,
        url: "https://agentos.example.com",
      };

      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(((_code?: number) => {
          throw new Error("__exit__");
        }) as never);
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      expect(() => assertManaged(sys)).toThrow("__exit__");
      const errMsg = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(errMsg).toMatch(/external AgentOS endpoint/);
      expect(errMsg).toMatch(/https:\/\/agentos.example.com/);
      expect(errMsg).toMatch(/ixora --system cloud agents list/);

      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("passes through for a managed system", async () => {
      const { assertManaged } = await import("../../src/commands/system.js");
      const sys = {
        id: "prod1",
        name: "Prod",
        kind: "managed" as const,
        mode: "full" as const,
      };

      expect(() => assertManaged(sys)).not.toThrow();
    });
  });
});
