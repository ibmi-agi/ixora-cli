import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SAMPLE_ENV } from "../helpers/fixtures.js";

const tmpDir = mkdtempSync(join(tmpdir(), "ixora-profile-"));
const ENV_FILE = join(tmpDir, ".env");

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  return { ...actual, ENV_FILE };
});

describe("profile", () => {
  beforeEach(() => {
    writeFileSync(ENV_FILE, SAMPLE_ENV);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveStackProfile", () => {
    it("returns explicit --profile when valid", async () => {
      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(resolveStackProfile({ profile: "api" })).toBe("api");
      expect(resolveStackProfile({ profile: "full" })).toBe("full");
    });

    it("trims whitespace from explicit --profile", async () => {
      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(resolveStackProfile({ profile: "  api  " })).toBe("api");
    });

    it("falls back to IXORA_PROFILE when --profile omitted", async () => {
      writeFileSync(ENV_FILE, SAMPLE_ENV.replace("IXORA_PROFILE='full'", "IXORA_PROFILE='api'"));
      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(resolveStackProfile({})).toBe("api");
    });

    it("falls back to 'full' when IXORA_PROFILE unset", async () => {
      writeFileSync(ENV_FILE, "IXORA_VERSION='latest'\n");
      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(resolveStackProfile({})).toBe("full");
    });

    it("dies with migration hint when --profile is an old agent-profile value", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {
          throw new Error("EXIT");
        }) as never);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(() => resolveStackProfile({ profile: "sql-services" })).toThrow(
        "EXIT",
      );
      expect(errSpy.mock.calls.flat().join(" ")).toContain("--agent-profile");

      exitSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("dies on a wholly bogus --profile value", async () => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {
          throw new Error("EXIT");
        }) as never);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(() => resolveStackProfile({ profile: "bogus" })).toThrow("EXIT");

      exitSpy.mockRestore();
    });

    it("coerces stale agent-profile in IXORA_PROFILE to 'full' with a warning", async () => {
      writeFileSync(
        ENV_FILE,
        SAMPLE_ENV.replace("IXORA_PROFILE='full'", "IXORA_PROFILE='security'"),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { resolveStackProfile } = await import("../../src/lib/profile.js");
      expect(resolveStackProfile({})).toBe("full");
      expect(logSpy.mock.calls.flat().join(" ")).toContain("Warning");

      logSpy.mockRestore();
    });
  });

  describe("persistStackProfile", () => {
    it("writes IXORA_PROFILE to the env file", async () => {
      const { persistStackProfile } = await import("../../src/lib/profile.js");
      persistStackProfile("api");
      const content = readFileSync(ENV_FILE, "utf-8");
      expect(content).toContain("IXORA_PROFILE='api'");
    });
  });

  describe("wasProfileExplicit", () => {
    it("is true when --profile is set", async () => {
      const { wasProfileExplicit } = await import("../../src/lib/profile.js");
      expect(wasProfileExplicit({ profile: "api" })).toBe(true);
    });
    it("is false when --profile is undefined or whitespace", async () => {
      const { wasProfileExplicit } = await import("../../src/lib/profile.js");
      expect(wasProfileExplicit({})).toBe(false);
      expect(wasProfileExplicit({ profile: "" })).toBe(false);
      expect(wasProfileExplicit({ profile: "  " })).toBe(false);
    });
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
