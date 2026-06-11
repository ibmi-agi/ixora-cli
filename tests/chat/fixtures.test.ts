import { describe, it, expect } from "vitest";
import { replayFixture, loadRequestFixture } from "./helpers.js";

interface ToolExecutionLike {
  tool_call_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  requires_confirmation: boolean;
  confirmed: boolean | null;
  confirmation_note: string | null;
}

interface RequirementLike {
  id: string;
  created_at: string;
  tool_execution: ToolExecutionLike;
}

/** Expected exact ordered event-name sequence per .sse fixture. */
const EXPECTED_SEQUENCES: Record<string, string[]> = {
  "simple-run.sse": [
    "RunStarted",
    "ModelRequestStarted", // unknown wire-only event — reducers must ignore it
    "RunContent",
    "RunContent",
    "RunContent",
    "RunContentCompleted",
    "RunCompleted",
    "MemoryUpdateStarted",
    "MemoryUpdateCompleted",
  ],
  "tool-run.sse": [
    "RunStarted",
    "RunContent",
    "ToolCallStarted",
    "ToolCallCompleted",
    "RunContent",
    "RunContentCompleted",
    "RunCompleted",
  ],
  "multi-tool-pause.sse": ["RunStarted", "RunContent", "RunPaused"],
  "approve-repause-approve.1.sse": ["RunStarted", "RunContent", "RunPaused"],
  "approve-repause-approve.2.sse": [
    "RunContinued",
    "ToolCallStarted",
    "ToolCallCompleted",
    "RunContent",
    "RunPaused",
  ],
  "approve-repause-approve.3.sse": [
    "RunContinued",
    "ToolCallStarted",
    "ToolCallCompleted",
    "RunContent",
    "RunContentCompleted",
    "RunCompleted",
  ],
  "reject-with-note.1.sse": ["RunStarted", "RunPaused"],
  "reject-with-note.2.sse": [
    "RunContinued",
    "RunContent",
    "RunContentCompleted",
    "RunCompleted",
  ],
  "team-two-members.sse": [
    "TeamRunStarted",
    "TeamRunContent",
    "TeamToolCallStarted",
    "RunStarted",
    "RunContent",
    "RunContent",
    "ToolCallStarted",
    "ToolCallCompleted",
    "RunContent",
    "RunCompleted",
    "TeamToolCallCompleted",
    "TeamToolCallStarted",
    "RunStarted",
    "RunContent",
    "RunCompleted",
    "TeamToolCallCompleted",
    "TeamRunContent",
    "TeamRunContentCompleted",
    "TeamRunCompleted",
  ],
  "workflow-steps.sse": [
    "WorkflowStarted",
    "StepStarted",
    "RunStarted",
    "RunContent",
    "RunContent",
    "RunCompleted",
    "StepOutput",
    "StepCompleted",
    "ParallelExecutionStarted",
    "StepStarted",
    "RunStarted",
    "RunContent",
    "RunCompleted",
    "StepCompleted",
    "ParallelExecutionCompleted",
    "WorkflowCompleted",
  ],
  "run-error.sse": ["RunStarted", "RunContent", "RunError"],
  "cancelled-run.sse": [
    "RunStarted",
    "RunContent",
    "RunContent",
    "RunCancelled",
  ],
};

describe("chat SSE fixtures replay through AgentStream.fromSSEResponse", () => {
  for (const [file, expected] of Object.entries(EXPECTED_SEQUENCES)) {
    it(`${file}: ${expected.length} events in exact order`, async () => {
      const events = await replayFixture(file);
      expect(events.map((e) => e.event)).toEqual(expected);
      expect(events).toHaveLength(expected.length);
      for (const event of events) {
        // created_at is unix SECONDS (10-digit range, not milliseconds).
        expect(typeof event.created_at).toBe("number");
        expect(event.created_at).toBeGreaterThan(1_000_000_000);
        expect(event.created_at).toBeLessThan(10_000_000_000);
      }
    });
  }

  it("simple-run: reasoning_content rides on a RunContent delta", async () => {
    const events = await replayFixture("simple-run.sse");
    expect(events[0].run_id).toBe("run-R1");
    expect(events[0].session_id).toBe("sess-S1");
    const withReasoning = events.filter(
      (e) => e.event === "RunContent" && typeof e.reasoning_content === "string",
    );
    expect(withReasoning.length).toBeGreaterThanOrEqual(1);
  });

  it("tool-run: completion re-sends the same tool_call_id with result", async () => {
    const events = await replayFixture("tool-run.sse");
    const started = events.find((e) => e.event === "ToolCallStarted");
    const completed = events.find((e) => e.event === "ToolCallCompleted");
    const startedTool = started?.tool as Record<string, unknown>;
    const completedTool = completed?.tool as Record<string, unknown>;
    expect(startedTool.tool_call_id).toBe("tc-a1");
    expect(completedTool.tool_call_id).toBe("tc-a1");
    expect(completedTool.tool_call_error).toBe(false);
    expect(typeof completedTool.result).toBe("string");
    expect((completedTool.metrics as Record<string, unknown>).duration).toBe(
      0.42,
    );
  });

  it("multi-tool-pause: RunPaused carries BOTH tools[] and requirements[]", async () => {
    const events = await replayFixture("multi-tool-pause.sse");
    const paused = events.find((e) => e.event === "RunPaused");
    expect(paused?.run_id).toBe("run-R3");
    expect(paused?.session_id).toBe("sess-S3");

    const tools = paused?.tools as ToolExecutionLike[];
    expect(tools).toHaveLength(2);

    const requirements = paused?.requirements as RequirementLike[];
    expect(requirements).toHaveLength(2);
    expect(requirements.map((r) => r.id)).toEqual(["req-1", "req-2"]);
    for (const [i, req] of requirements.entries()) {
      expect(typeof req.created_at).toBe("string");
      const exec = req.tool_execution;
      expect(exec.tool_call_id).toBe(tools[i].tool_call_id);
      expect(exec.requires_confirmation).toBe(true);
      expect(exec.confirmed).toBeNull();
      expect(exec.confirmation_note).toBeNull();
    }
    expect(requirements.map((r) => r.tool_execution.tool_call_id)).toEqual([
      "tc-h1",
      "tc-h2",
    ]);
  });

  it("approve-repause-approve: run_id/session_id invariant, fresh requirements each round", async () => {
    const part1 = await replayFixture("approve-repause-approve.1.sse");
    const part2 = await replayFixture("approve-repause-approve.2.sse");
    const part3 = await replayFixture("approve-repause-approve.3.sse");

    for (const events of [part1, part2, part3]) {
      for (const e of events) {
        expect(e.run_id).toBe("run-R4");
        expect(e.session_id).toBe("sess-S4");
      }
    }

    const pause1 = part1.find((e) => e.event === "RunPaused");
    const pause2 = part2.find((e) => e.event === "RunPaused");
    const reqs1 = pause1?.requirements as RequirementLike[];
    const reqs2 = pause2?.requirements as RequirementLike[];
    expect(reqs1[0].tool_execution.tool_call_id).toBe("tc-h3");
    expect(reqs2[0].tool_execution.tool_call_id).toBe("tc-h4");
    expect(reqs1[0].tool_execution.tool_call_id).not.toBe(
      reqs2[0].tool_execution.tool_call_id,
    );

    // Continue streams execute the just-approved tool.
    const exec2 = part2.find((e) => e.event === "ToolCallCompleted");
    expect((exec2?.tool as Record<string, unknown>).tool_call_id).toBe("tc-h3");
    const exec3 = part3.find((e) => e.event === "ToolCallCompleted");
    expect((exec3?.tool as Record<string, unknown>).tool_call_id).toBe("tc-h4");
  });

  it("approve-repause-approve: recorded continue request bodies are stamped confirmed:true", async () => {
    const req2 = await loadRequestFixture("approve-repause-approve.2");
    expect(req2.session_id).toBe("sess-S4");
    expect(typeof req2.tools).toBe("string");
    const tools2 = JSON.parse(req2.tools) as ToolExecutionLike[];
    expect(tools2).toHaveLength(1);
    expect(tools2[0].tool_call_id).toBe("tc-h3");
    expect(tools2[0].confirmed).toBe(true);
    expect(tools2[0].confirmation_note).toBeNull();

    const req3 = await loadRequestFixture("approve-repause-approve.3");
    expect(req3.session_id).toBe("sess-S4");
    const tools3 = JSON.parse(req3.tools) as ToolExecutionLike[];
    expect(tools3).toHaveLength(1);
    expect(tools3[0].tool_call_id).toBe("tc-h4");
    expect(tools3[0].confirmed).toBe(true);
  });

  it("reject-with-note: note round-trips in the continue request; run reaches terminal state", async () => {
    const req = await loadRequestFixture("reject-with-note.2");
    expect(req.session_id).toBe("sess-S5");
    const tools = JSON.parse(req.tools) as ToolExecutionLike[];
    expect(tools).toHaveLength(1);
    expect(tools[0].tool_call_id).toBe("tc-h5");
    expect(tools[0].confirmed).toBe(false);
    expect(tools[0].confirmation_note).toBe("do not run this on PROD");

    const part2 = await replayFixture("reject-with-note.2.sse");
    expect(part2.at(-1)?.event).toBe("RunCompleted");
    for (const e of part2) {
      expect(e.run_id).toBe("run-R5");
      expect(e.session_id).toBe("sess-S5");
    }
  });

  it("team-two-members: delegation windows carry member_id/task; members attributed by agent_id", async () => {
    const events = await replayFixture("team-two-members.sse");
    const delegations = events.filter(
      (e) =>
        e.event === "TeamToolCallStarted" &&
        (e.tool as Record<string, unknown>).tool_name ===
          "delegate_task_to_member",
    );
    expect(delegations).toHaveLength(2);
    const args = delegations.map(
      (e) =>
        (e.tool as Record<string, unknown>).tool_args as Record<
          string,
          unknown
        >,
    );
    expect(args[0].member_id).toBe("member-one");
    expect(args[1].member_id).toBe("member-two");
    expect(typeof args[0].task).toBe("string");

    // Member RunStarted upgrades the provisional member_id title.
    const memberStarts = events.filter((e) => e.event === "RunStarted");
    expect(memberStarts.map((e) => e.agent_id)).toEqual([
      "agent-one",
      "agent-two",
    ]);
    expect(memberStarts.map((e) => e.agent_name)).toEqual([
      "Agent One",
      "Agent Two",
    ]);

    // Member RunCompleted arrives BEFORE TeamToolCallCompleted (must not close block).
    const names = events.map((e) => e.event);
    expect(names.indexOf("RunCompleted")).toBeLessThan(
      names.indexOf("TeamToolCallCompleted"),
    );

    const completed = events.at(-1);
    expect(completed?.event).toBe("TeamRunCompleted");
    expect(completed?.member_responses).toHaveLength(2);
  });

  it("workflow-steps: nested agent events carry workflow_id+step_id+step_name; tuple step_index", async () => {
    const events = await replayFixture("workflow-steps.sse");
    const nested = events.filter((e) =>
      ["RunStarted", "RunContent", "RunCompleted"].includes(e.event),
    );
    expect(nested.length).toBeGreaterThan(0);
    for (const e of nested) {
      expect(e.workflow_id).toBe("wf-one");
      expect(typeof e.step_id).toBe("string");
      expect(typeof e.step_name).toBe("string");
    }

    const step2Started = events.filter((e) => e.event === "StepStarted")[1];
    expect(step2Started.step_index).toEqual([1, 0]);

    const stepOutput = events.find((e) => e.event === "StepOutput");
    const output = stepOutput?.step_output as Record<string, unknown>;
    expect(output.step_name).toBe("step-1");
    expect(output.success).toBe(true);

    const parallel = events.find(
      (e) => e.event === "ParallelExecutionStarted",
    );
    expect(parallel?.parallel_step_count).toBe(2);
  });

  it("run-error: terminal RunError with message in content, no RunCompleted", async () => {
    const events = await replayFixture("run-error.sse");
    const last = events.at(-1);
    expect(last?.event).toBe("RunError");
    expect(last?.content).toContain("Tool execution failed");
    expect(events.some((e) => e.event === "RunCompleted")).toBe(false);
  });

  it("cancelled-run: terminal RunCancelled with reason, partial text preserved", async () => {
    const events = await replayFixture("cancelled-run.sse");
    const last = events.at(-1);
    expect(last?.event).toBe("RunCancelled");
    expect(last?.reason).toBe("cancelled by user");
    const deltas = events.filter((e) => e.event === "RunContent");
    expect(deltas).toHaveLength(2);
  });
});
