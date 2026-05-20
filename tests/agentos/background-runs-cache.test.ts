import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Verifies the local background-run cache: round-trip, 0600 file mode,
// bypass_confirmations persistence, newest-first listing, status patching,
// and 7-day stale cleanup. The cache dir is redirected to a temp HOME via
// the IXORA_DIR mock.

const tmpHome = mkdtempSync(join(tmpdir(), "ixora-bg-cache-"));
mkdirSync(join(tmpHome, ".ixora"), { recursive: true });

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  return { ...actual, IXORA_DIR: join(tmpHome, ".ixora") };
});

const {
  writeBackgroundRun,
  readBackgroundRun,
  listBackgroundRuns,
  deleteBackgroundRun,
  updateBackgroundRunStatus,
  cleanStaleBackgroundRuns,
} = await import("../../src/lib/agentos-background-runs.js");

type State = Parameters<typeof writeBackgroundRun>[0];

function sample(overrides: Partial<State> = {}): State {
  return {
    run_id: "run-1",
    resource_type: "agent",
    resource_id: "ag-1",
    session_id: "sess-1",
    status: "PENDING",
    prompt: "do a thing",
    started_at: new Date().toISOString(),
    bypass_confirmations: false,
    ...overrides,
  };
}

const cacheFile = (runId: string): string =>
  join(tmpHome, ".ixora", "agentos-background-runs", `${runId}.json`);

describe("agentos-background-runs cache", () => {
  afterEach(() => {
    for (const r of listBackgroundRuns()) deleteBackgroundRun(r.run_id);
  });

  it("round-trips write and read", () => {
    writeBackgroundRun(sample());
    expect(readBackgroundRun("run-1")?.resource_id).toBe("ag-1");
  });

  it("returns null for an unknown run", () => {
    expect(readBackgroundRun("nope")).toBeNull();
  });

  it("persists the bypass_confirmations flag", () => {
    writeBackgroundRun(sample({ run_id: "run-b", bypass_confirmations: true }));
    expect(readBackgroundRun("run-b")?.bypass_confirmations).toBe(true);
  });

  it("writes cache files with mode 0600", () => {
    writeBackgroundRun(sample({ run_id: "run-mode" }));
    expect(statSync(cacheFile("run-mode")).mode & 0o777).toBe(0o600);
  });

  it("lists runs newest-first by started_at", () => {
    writeBackgroundRun(
      sample({ run_id: "old", started_at: "2026-01-01T00:00:00Z" }),
    );
    writeBackgroundRun(
      sample({ run_id: "new", started_at: "2026-05-01T00:00:00Z" }),
    );
    expect(listBackgroundRuns().map((r) => r.run_id)).toEqual(["new", "old"]);
  });

  it("updateBackgroundRunStatus patches status and session_id", () => {
    writeBackgroundRun(sample({ run_id: "run-u", session_id: null }));
    updateBackgroundRunStatus("run-u", "COMPLETED", "sess-x");
    const r = readBackgroundRun("run-u");
    expect(r?.status).toBe("COMPLETED");
    expect(r?.session_id).toBe("sess-x");
  });

  it("updateBackgroundRunStatus is a no-op for an uncached run", () => {
    updateBackgroundRunStatus("ghost", "COMPLETED");
    expect(readBackgroundRun("ghost")).toBeNull();
  });

  it("deleteBackgroundRun removes the entry", () => {
    writeBackgroundRun(sample({ run_id: "run-d" }));
    deleteBackgroundRun("run-d");
    expect(readBackgroundRun("run-d")).toBeNull();
  });

  it("cleanStaleBackgroundRuns drops entries older than 7 days", () => {
    writeBackgroundRun(sample({ run_id: "stale" }));
    const eightDaysAgo = Date.now() / 1000 - 8 * 24 * 60 * 60;
    utimesSync(cacheFile("stale"), eightDaysAgo, eightDaysAgo);
    cleanStaleBackgroundRuns();
    expect(existsSync(cacheFile("stale"))).toBe(false);
  });
});
