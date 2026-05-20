import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the `<resource> runs` command: list mode reads only the local
// cache (no server call), poll mode hits the server, refreshes the cache,
// and sets the status-derived exit code.

const requestFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
    agents = { continue: vi.fn() };
    teams = { continue: vi.fn() };
    workflows = { continue: vi.fn() };
  }
  return { AgentOSClient };
});

const tmpHome = mkdtempSync(join(tmpdir(), "ixora-runs-cmd-"));
mkdirSync(join(tmpHome, ".ixora"), { recursive: true });

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  return { ...actual, IXORA_DIR: join(tmpHome, ".ixora") };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);
const {
  writeBackgroundRun,
  readBackgroundRun,
  listBackgroundRuns,
  deleteBackgroundRun,
} = await import("../../src/lib/agentos-background-runs.js");

type State = Parameters<typeof writeBackgroundRun>[0];
function seed(overrides: Partial<State> = {}): void {
  writeBackgroundRun({
    run_id: "run-1",
    resource_type: "agent",
    resource_id: "ag-1",
    session_id: "sess-1",
    status: "PENDING",
    prompt: "do a thing",
    started_at: new Date().toISOString(),
    bypass_confirmations: false,
    ...overrides,
  });
}

describe("agents runs command", () => {
  let stdout: string[];
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    requestFn.mockReset();
    for (const r of listBackgroundRuns()) deleteBackgroundRun(r.run_id);
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    stdout = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("list mode reads the local cache and makes no server call", async () => {
    seed({ run_id: "run-a" });
    seed({ run_id: "run-b" });
    seed({ run_id: "run-team", resource_type: "team", resource_id: "t1" });

    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "runs",
      "--url",
      "http://test",
    ]);

    const out = JSON.parse(stdout.join(""));
    const ids = (out.data as Array<{ run_id: string }>).map((r) => r.run_id);
    expect(ids.sort()).toEqual(["run-a", "run-b"]); // team run excluded
    expect(requestFn).not.toHaveBeenCalled();
  });

  it("poll mode hits the server, refreshes the cache, and exits 0 when COMPLETED", async () => {
    seed({ run_id: "run-1", status: "PENDING" });
    requestFn.mockResolvedValue({
      run_id: "run-1",
      session_id: "sess-1",
      status: "COMPLETED",
      content: "done",
    });

    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "runs",
      "run-1",
      "--url",
      "http://test",
    ]);

    expect(requestFn.mock.calls[0]?.[0]).toBe("GET");
    expect(requestFn.mock.calls[0]?.[1]).toContain("/agents/ag-1/runs/run-1");
    expect(readBackgroundRun("run-1")?.status).toBe("COMPLETED");
    expect(process.exitCode).toBe(0);
  });

  it("poll mode exits 2 when the run ERRORed", async () => {
    seed({ run_id: "run-1" });
    requestFn.mockResolvedValue({ run_id: "run-1", status: "ERROR" });

    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "runs",
      "run-1",
      "--url",
      "http://test",
    ]);

    expect(process.exitCode).toBe(2);
  });

  it("poll mode errors when the run is not in the cache", async () => {
    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "runs",
      "missing-run",
      "--url",
      "http://test",
    ]);

    expect(process.exitCode).toBe(1);
    expect(requestFn).not.toHaveBeenCalled();
  });
});
