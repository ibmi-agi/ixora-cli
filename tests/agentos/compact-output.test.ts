import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies the `-o compact` projection for `agents run`:
//   1. COMPLETED response → 7-key shape, pending_tool: null
//   2. PAUSED with one pending tool → pending_tool is an object
//   3. PAUSED with two pending tools → pending_tool is an array
//   4. --json + -o compact → full JSON (--json wins per documented precedence)

const COMPLETED = {
  status: "COMPLETED",
  run_id: "run-c",
  session_id: "sess-c",
  agent_id: "ag-1",
  content: "all done",
  metrics: { input_tokens: 10, output_tokens: 5, total_tokens: 15, duration: 1.2 },
};

const PAUSED_ONE = {
  status: "PAUSED",
  run_id: "run-p1",
  session_id: "sess-p1",
  agent_id: "ag-1",
  content: "",
  requirements: [
    {
      tool_execution: {
        tool_call_id: "tc-1",
        tool_name: "validate_and_run_sql",
        tool_args: { statement: "SELECT 1" },
        requires_confirmation: true,
        confirmed: null,
      },
    },
  ],
};

const PAUSED_TWO = {
  ...PAUSED_ONE,
  run_id: "run-p2",
  session_id: "sess-p2",
  requirements: [
    {
      tool_execution: {
        tool_call_id: "tc-a",
        tool_name: "validate_and_run_sql",
        tool_args: { statement: "SELECT 1" },
        requires_confirmation: true,
        confirmed: null,
      },
    },
    {
      tool_execution: {
        tool_call_id: "tc-b",
        tool_name: "run_cl",
        tool_args: { command: "DSPSYSSTS" },
        requires_confirmation: true,
        confirmed: null,
      },
    },
  ],
};

const runFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    agents = {
      run: runFn,
    };
  }
  return { AgentOSClient };
});

vi.mock("../../src/lib/agentos-paused-runs.js", async () => {
  const actual =
    await vi.importActual<
      typeof import("../../src/lib/agentos-paused-runs.js")
    >("../../src/lib/agentos-paused-runs.js");
  return {
    ...actual,
    writePausedRun: vi.fn(),
    readPausedRun: vi.fn().mockReturnValue(null),
    deletePausedRun: vi.fn(),
  };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);
const { projectCompact, extractPendingTools } = await import(
  "../../src/lib/agentos-stream.js"
);

async function runAgentsRun(argv: string[]): Promise<string> {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const program = createProgram();
    await program.parseAsync(["node", "ixora", ...argv]);
    return writes.join("");
  } finally {
    spy.mockRestore();
  }
}

describe("projectCompact (pure projection)", () => {
  it("produces 7-key shape with null pending_tool for COMPLETED responses", () => {
    const compact = projectCompact(COMPLETED, []);
    expect(Object.keys(compact).sort()).toEqual([
      "agent_id",
      "content",
      "metrics",
      "pending_tool",
      "run_id",
      "session_id",
      "status",
    ]);
    expect(compact.pending_tool).toBeNull();
    expect(compact.status).toBe("COMPLETED");
    expect(compact.content).toBe("all done");
    expect(compact.metrics.total_tokens).toBe(15);
  });

  it("returns pending_tool as a single object when one tool is pending", () => {
    const pending = extractPendingTools(PAUSED_ONE);
    const compact = projectCompact(PAUSED_ONE, pending);
    expect(Array.isArray(compact.pending_tool)).toBe(false);
    expect(compact.pending_tool).toMatchObject({
      tool_call_id: "tc-1",
      tool_name: "validate_and_run_sql",
    });
  });

  it("returns pending_tool as an array when multiple tools are pending", () => {
    const pending = extractPendingTools(PAUSED_TWO);
    const compact = projectCompact(PAUSED_TWO, pending);
    expect(Array.isArray(compact.pending_tool)).toBe(true);
    expect((compact.pending_tool as unknown[]).length).toBe(2);
  });
});

describe("agents run -o compact end-to-end", () => {
  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    runFn.mockReset();
  });

  it("emits compact JSON for a COMPLETED response", async () => {
    runFn.mockResolvedValue(COMPLETED);
    const out = await runAgentsRun([
      "agents",
      "run",
      "ag-1",
      "hi",
      "-o",
      "compact",
      "--url",
      "http://test",
    ]);
    const parsed = JSON.parse(out.trim());
    expect(parsed.status).toBe("COMPLETED");
    expect(parsed.pending_tool).toBeNull();
    expect(Object.keys(parsed).sort()).toEqual([
      "agent_id",
      "content",
      "metrics",
      "pending_tool",
      "run_id",
      "session_id",
      "status",
    ]);
  });

  it("--json wins over -o compact (precedence)", async () => {
    runFn.mockResolvedValue(COMPLETED);
    const out = await runAgentsRun([
      "agents",
      "run",
      "ag-1",
      "hi",
      "--json",
      "-o",
      "compact",
      "--url",
      "http://test",
    ]);
    const parsed = JSON.parse(out.trim());
    // Full SDK shape: no "pending_tool" key in the raw response.
    expect(parsed).not.toHaveProperty("pending_tool");
    expect(parsed).toHaveProperty("metrics");
    expect(parsed.status).toBe("COMPLETED");
  });
});
