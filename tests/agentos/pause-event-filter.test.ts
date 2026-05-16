import { describe, expect, it, vi } from "vitest";

// Regression test: when AgentOS emits a `RunPaused` event, the `tools[]`
// payload includes every tool call from the run — completed ones AND the
// one(s) actually awaiting confirmation. The CLI used to forward all of
// them to the cache and the interactive prompt, producing
// "6 tool call(s) require confirmation" for runs where only 1 was pending.
//
// `handleStreamRun` should now filter to `requires_confirmation === true
// && confirmed == null` before caching or prompting.

const mergePausedRunSpy = vi.fn();
vi.mock("../../src/lib/agentos-paused-runs.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/agentos-paused-runs.js")
  >("../../src/lib/agentos-paused-runs.js");
  return {
    ...actual,
    mergePausedRun: (state: unknown) => mergePausedRunSpy(state),
    writePausedRun: vi.fn(),
    readPausedRun: vi.fn().mockReturnValue(null),
    listPausedRuns: vi.fn().mockReturnValue([]),
    deletePausedRun: vi.fn(),
  };
});

const { handleStreamRun } = await import("../../src/lib/agentos-stream.js");
const { Command } = await import("commander");

// 5 already-completed tool calls + 1 pending. The shape mirrors what the
// IBM i text-to-SQL agent sends when it pauses on validate_and_run_sql
// after running search_learnings, list_tables, and two list_columns calls.
const MIXED_TOOLS = [
  {
    tool_call_id: "tc-search",
    tool_name: "search_learnings",
    tool_args: { query: "..." },
    requires_confirmation: false,
    confirmed: true,
  },
  {
    tool_call_id: "tc-list-tables",
    tool_name: "list_tables",
    tool_args: { schema: "SAMPLE" },
    requires_confirmation: false,
    confirmed: true,
  },
  {
    tool_call_id: "tc-list-cols-emp",
    tool_name: "list_columns",
    tool_args: { schema: "SAMPLE", table: "EMPLOYEE" },
    requires_confirmation: false,
    confirmed: true,
  },
  {
    tool_call_id: "tc-list-cols-dept",
    tool_name: "list_columns",
    tool_args: { schema: "SAMPLE", table: "DEPARTMENT" },
    requires_confirmation: false,
    confirmed: true,
  },
  {
    tool_call_id: "tc-pending",
    tool_name: "validate_and_run_sql",
    tool_args: { statement: "SELECT * FROM SAMPLE.EMPLOYEE" },
    requires_confirmation: true,
    confirmed: null,
  },
];

async function* mockPausedStream() {
  yield { event: "RunStarted", run_id: "run-1", session_id: "sess-1" };
  yield {
    event: "RunPaused",
    run_id: "run-1",
    tools: MIXED_TOOLS,
  };
}

describe("RunPaused event filtering", () => {
  it("filters completed tool calls out of the pause cache", async () => {
    mergePausedRunSpy.mockClear();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const cmd = new Command();
    const fakeStream = Object.assign(mockPausedStream(), {
      abort: () => {},
    });

    const result = await handleStreamRun(
      cmd,
      // biome-ignore lint/suspicious/noExplicitAny: test fixture stream shape
      fakeStream as any,
      "agent",
      { resourceId: "ibmi-agent--default" },
    );

    expect(result.paused).toBe(true);
    expect(result.pendingTools).toHaveLength(1);
    expect(result.pendingTools?.[0]?.tool_call_id).toBe("tc-pending");
    expect(result.pendingTools?.[0]?.tool_name).toBe("validate_and_run_sql");

    expect(mergePausedRunSpy).toHaveBeenCalledOnce();
    const cached = mergePausedRunSpy.mock.calls[0]?.[0] as {
      tools: Array<{ tool_call_id: string }>;
    };
    expect(cached.tools).toHaveLength(1);
    expect(cached.tools[0]?.tool_call_id).toBe("tc-pending");
  });
});
