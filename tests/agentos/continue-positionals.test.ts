import { describe, expect, it } from "vitest";
import { parseContinuePositionals } from "../../src/agentos/agents.js";

// Verifies the dual-form positional schema added for /goal #6:
//   `agents continue <agent_id> <run_id> [tool_results]`  (legacy)
//   `agents continue <run_id>          [tool_results]`    (cache lookup)
// Disambiguation is by argument count, with a JSON-shape sniff for the
// 2-positional case where someone passed `<run_id> <tool_results_json>`.

describe("parseContinuePositionals", () => {
  it("treats one positional as run_id (cache form)", () => {
    expect(parseContinuePositionals("run-abc", undefined, undefined)).toEqual({
      runId: "run-abc",
    });
  });

  it("treats two non-JSON positionals as <agent_id> <run_id>", () => {
    expect(parseContinuePositionals("ag-1", "run-abc", undefined)).toEqual({
      agentId: "ag-1",
      runId: "run-abc",
    });
  });

  it("treats two positionals as <run_id> <tool_results> when arg2 is JSON-shaped", () => {
    expect(
      parseContinuePositionals("run-abc", '{"tool_call_id":"x"}', undefined),
    ).toEqual({
      runId: "run-abc",
      toolResults: '{"tool_call_id":"x"}',
    });
    expect(
      parseContinuePositionals("run-abc", '[{"id":1}]', undefined),
    ).toEqual({
      runId: "run-abc",
      toolResults: '[{"id":1}]',
    });
  });

  it("treats three positionals as <agent_id> <run_id> <tool_results>", () => {
    expect(
      parseContinuePositionals("ag-1", "run-abc", '{"x":1}'),
    ).toEqual({
      agentId: "ag-1",
      runId: "run-abc",
      toolResults: '{"x":1}',
    });
  });

  it("returns empty object when no positionals supplied", () => {
    expect(parseContinuePositionals(undefined, undefined, undefined)).toEqual(
      {},
    );
  });
});
