import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies --bypass-confirmations: the watchRun auto-confirm loop drives a
// paused run to completion (and stops at exit 4 without bypass), and a
// foreground `run --bypass-confirmations` wires into the same loop.

const requestFn = vi.fn();
const continueFn = vi.fn();
const runFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
    agents = { run: runFn, continue: continueFn };
    teams = { continue: vi.fn() };
    workflows = { continue: vi.fn() };
  }
  return { AgentOSClient };
});

const tmpHome = mkdtempSync(join(tmpdir(), "ixora-bypass-"));
mkdirSync(join(tmpHome, ".ixora"), { recursive: true });

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  return { ...actual, IXORA_DIR: join(tmpHome, ".ixora") };
});

const { watchRun } = await import("../../src/lib/agentos-runs-command.js");
const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);
const { AgentOSClient } = await import("@worksofadam/agentos-sdk");
const { Command } = await import("commander");
const { writeBackgroundRun, listBackgroundRuns, deleteBackgroundRun } =
  await import("../../src/lib/agentos-background-runs.js");

const PAUSED = {
  run_id: "run-1",
  session_id: "sess-1",
  status: "PAUSED",
  tools: [
    {
      tool_call_id: "tc-1",
      tool_name: "drop_table",
      tool_args: {},
      requires_confirmation: true,
      confirmed: null,
    },
  ],
};
const COMPLETED = {
  run_id: "run-1",
  session_id: "sess-1",
  status: "COMPLETED",
  content: "done",
};

describe("watchRun auto-confirm loop", () => {
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    for (const r of listBackgroundRuns()) deleteBackgroundRun(r.run_id);
    requestFn.mockReset();
    continueFn.mockReset().mockResolvedValue({});
    runFn.mockReset();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("auto-confirms a paused run and continues until COMPLETED", async () => {
    requestFn.mockResolvedValueOnce(PAUSED).mockResolvedValueOnce(COMPLETED);
    const client = new AgentOSClient({ baseUrl: "http://test" });
    await watchRun(
      client,
      new Command(),
      "agent",
      { resourceId: "ag-1", runId: "run-1", sessionId: "sess-1" },
      { bypass: true, intervalMs: 1 },
    );
    expect(continueFn).toHaveBeenCalledOnce();
    const payload = JSON.parse(
      continueFn.mock.calls[0]?.[2]?.tools as string,
    ) as Array<{ confirmed: boolean }>;
    expect(payload[0]?.confirmed).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("stops at the pause with exit 4 when bypass is off", async () => {
    requestFn.mockResolvedValueOnce(PAUSED);
    const client = new AgentOSClient({ baseUrl: "http://test" });
    await watchRun(
      client,
      new Command(),
      "agent",
      { resourceId: "ag-1", runId: "run-1", sessionId: "sess-1" },
      { bypass: false, intervalMs: 1 },
    );
    expect(continueFn).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(4);
  });

  it("polls through RUNNING until COMPLETED", async () => {
    requestFn
      .mockResolvedValueOnce({ status: "RUNNING" })
      .mockResolvedValueOnce(COMPLETED);
    const client = new AgentOSClient({ baseUrl: "http://test" });
    await watchRun(
      client,
      new Command(),
      "agent",
      { resourceId: "ag-1", runId: "run-1", sessionId: "sess-1" },
      { bypass: true, intervalMs: 1 },
    );
    expect(process.exitCode).toBe(0);
  });

  it("foreground `run --bypass-confirmations` drives a paused run to done", async () => {
    runFn.mockResolvedValue(PAUSED);
    requestFn.mockResolvedValueOnce(PAUSED).mockResolvedValueOnce(COMPLETED);

    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "run",
      "ag-1",
      "drop the temp tables",
      "--bypass-confirmations",
      "--url",
      "http://test",
    ]);

    expect(runFn).toHaveBeenCalledOnce();
    expect(continueFn).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it("`runs --watch` honors the bypass intent recorded at run creation", async () => {
    // The run was started with `run --background --bypass-confirmations`, so
    // the cache carries bypass_confirmations:true — `runs --watch` (which has
    // no --bypass-confirmations flag) must still auto-confirm.
    writeBackgroundRun({
      run_id: "run-1",
      resource_type: "agent",
      resource_id: "ag-1",
      session_id: "sess-1",
      status: "PENDING",
      prompt: "drop the temp tables",
      started_at: new Date().toISOString(),
      bypass_confirmations: true,
    });
    requestFn.mockResolvedValueOnce(PAUSED).mockResolvedValueOnce(COMPLETED);

    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "runs",
      "run-1",
      "--watch",
      "--url",
      "http://test",
    ]);

    expect(continueFn).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });
});
