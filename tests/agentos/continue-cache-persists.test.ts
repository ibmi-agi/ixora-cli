import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies that `agents continue` non-stream:
//   1. writes a fresh paused-state cache entry when the continued run re-pauses
//   2. extracts pending tools from `requirements[].tool_execution` when present
//   3. falls back to filtering `tools[]` by `requires_confirmation && confirmed == null`

const PAUSED_WITH_REQUIREMENTS = {
  status: "PAUSED",
  run_id: "run-2",
  session_id: "sess-2",
  agent_id: "ag-1",
  content: "thinking...",
  tools: [
    {
      tool_call_id: "tc-completed",
      tool_name: "validate_sql",
      tool_args: { statement: "SELECT 1" },
      requires_confirmation: false,
      confirmed: true,
    },
    {
      tool_call_id: "tc-pending",
      tool_name: "validate_and_run_sql",
      tool_args: { statement: "SELECT 1" },
      requires_confirmation: true,
      confirmed: null,
    },
  ],
  requirements: [
    {
      id: "req-1",
      created_at: "2026-05-15T20:00:00Z",
      tool_execution: {
        tool_call_id: "tc-pending",
        tool_name: "validate_and_run_sql",
        tool_args: { statement: "SELECT 1" },
        requires_confirmation: true,
        confirmed: null,
      },
    },
  ],
  metrics: { input_tokens: 1, output_tokens: 1, total_tokens: 2, duration: 0.1 },
};

const PAUSED_TOOLS_ONLY = {
  ...PAUSED_WITH_REQUIREMENTS,
  requirements: [],
};

const CACHED_FIRST_PAUSE = {
  agent_id: "ag-1",
  run_id: "run-1",
  session_id: "sess-1",
  resource_type: "agent",
  paused_at: "2026-05-15T19:00:00Z",
  tools: [
    {
      tool_call_id: "tc-first",
      tool_name: "validate_and_run_sql",
      tool_args: { statement: "SELECT 0" },
      requires_confirmation: true,
      confirmed: null,
    },
  ],
};

const continueFn = vi.fn().mockResolvedValue(PAUSED_WITH_REQUIREMENTS);

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    agents = {
      continue: continueFn,
    };
  }
  return { AgentOSClient };
});

const writePausedRunSpy = vi.fn();
vi.mock("../../src/lib/agentos-paused-runs.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("../../src/lib/agentos-paused-runs.js")
    >("../../src/lib/agentos-paused-runs.js");
  return {
    ...actual,
    writePausedRun: (state: unknown) => writePausedRunSpy(state),
    readPausedRun: vi.fn().mockReturnValue(CACHED_FIRST_PAUSE),
    deletePausedRun: vi.fn(),
  };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);
const { extractPendingTools } = await import(
  "../../src/lib/agentos-stream.js"
);

describe("agents continue --confirm: paused-state cache persists across re-pause", () => {
  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    writePausedRunSpy.mockClear();
    continueFn.mockClear();
    continueFn.mockResolvedValue(PAUSED_WITH_REQUIREMENTS);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("writes cache from requirements[].tool_execution when the continue response re-pauses", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "continue",
      "ag-1",
      "run-1",
      "--confirm",
      "--url",
      "http://test",
    ]);

    expect(writePausedRunSpy).toHaveBeenCalledOnce();
    const written = writePausedRunSpy.mock.calls[0]?.[0] as {
      tools: Array<{ tool_call_id: string; tool_name: string }>;
      run_id: string;
    };
    expect(written.run_id).toBe("run-2");
    expect(written.tools).toHaveLength(1);
    expect(written.tools[0]?.tool_call_id).toBe("tc-pending");
    expect(written.tools[0]?.tool_name).toBe("validate_and_run_sql");
  });

  it("falls back to filtering tools[] when requirements[] is absent", () => {
    const pending = extractPendingTools(PAUSED_TOOLS_ONLY);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.tool_call_id).toBe("tc-pending");
  });

  it("returns empty array when neither requirements nor pending tools present", () => {
    expect(extractPendingTools({ status: "COMPLETED" })).toEqual([]);
    expect(extractPendingTools(null)).toEqual([]);
    expect(
      extractPendingTools({ tools: [{ requires_confirmation: false }] }),
    ).toEqual([]);
  });

  it("filters out already-confirmed tool_executions from requirements[]", () => {
    const mixed = {
      requirements: [
        {
          tool_execution: {
            tool_call_id: "already-done",
            tool_name: "validate_and_run_sql",
            tool_args: { statement: "SELECT 1" },
            requires_confirmation: false,
            confirmed: true,
          },
        },
        {
          tool_execution: {
            tool_call_id: "still-pending",
            tool_name: "validate_and_run_sql",
            tool_args: { statement: "SELECT 2" },
            requires_confirmation: true,
            confirmed: null,
          },
        },
      ],
    };
    const pending = extractPendingTools(mixed);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.tool_call_id).toBe("still-pending");
  });
});
