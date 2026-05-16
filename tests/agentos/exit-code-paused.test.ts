import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// /goal #4: handleNonStreamRun must set process.exitCode = EXIT_CODE_PAUSED (4)
// when the agent paused, so scripts can branch on the pause without parsing
// the JSON output.

vi.mock("../../src/lib/agentos-paused-runs.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/agentos-paused-runs.js")
  >("../../src/lib/agentos-paused-runs.js");
  return {
    ...actual,
    mergePausedRun: vi.fn(),
    writePausedRun: vi.fn(),
    readPausedRun: vi.fn().mockReturnValue(null),
    listPausedRuns: vi.fn().mockReturnValue([]),
    deletePausedRun: vi.fn(),
  };
});

const { handleNonStreamRun, EXIT_CODE_PAUSED } = await import(
  "../../src/lib/agentos-stream.js"
);
const { Command } = await import("commander");

const PAUSED_RESULT = {
  status: "PAUSED",
  run_id: "run-1",
  session_id: "sess-1",
  agent_id: "ag-1",
  content: "thinking…",
  tools: [
    {
      tool_call_id: "tc-1",
      tool_name: "validate_and_run_sql",
      tool_args: { statement: "SELECT 1" },
      requires_confirmation: true,
      confirmed: null,
    },
  ],
  metrics: {},
};

const COMPLETED_RESULT = {
  status: "COMPLETED",
  run_id: "run-1",
  session_id: "sess-1",
  agent_id: "ag-1",
  content: "done",
  metrics: {},
};

describe("handleNonStreamRun exit code on pause", () => {
  let originalExitCode: number | string | undefined;
  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("sets process.exitCode to EXIT_CODE_PAUSED when the run paused", async () => {
    const cmd = new Command();
    await handleNonStreamRun(
      cmd,
      { result: PAUSED_RESULT },
      { resourceType: "agent", resourceId: "ag-1" },
    );
    expect(process.exitCode).toBe(EXIT_CODE_PAUSED);
    expect(EXIT_CODE_PAUSED).toBe(4);
  });

  it("leaves process.exitCode unset when the run completed cleanly", async () => {
    const cmd = new Command();
    await handleNonStreamRun(
      cmd,
      { result: COMPLETED_RESULT },
      { resourceType: "agent", resourceId: "ag-1" },
    );
    expect(process.exitCode).toBe(0);
  });
});
