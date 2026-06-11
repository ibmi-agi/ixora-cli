// Regression tests for team-executor steps inside workflow streams (T4.2
// review HIGH finding): nested Team* events must route into the open step —
// never clobber the top-level run keys (run_id/header/status/metrics), which
// would corrupt Esc-cancel targeting and announce completion mid-run. agno
// enriches EVERY executor event with workflow_id/step_id/step_name; member
// agent events additionally carry the member's own run_id/agent_id.

import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@worksofadam/agentos-sdk";
import {
  createInitialState,
  reduce,
} from "../../src/lib/chat/reducer.js";
import type {
  MemberBlock,
  StepBlock,
  TextBlock,
  TranscriptState,
} from "../../src/lib/chat/types.js";

let clock = 1781179200;
function ev(name: string, fields: Record<string, unknown> = {}): StreamEvent {
  clock += 1;
  return { event: name, created_at: clock, ...fields } as StreamEvent;
}

const STEP = { workflow_id: "wf-1", step_id: "s1", step_name: "team-step" };

function runSequence(events: StreamEvent[]): TranscriptState {
  let state = createInitialState();
  for (const event of events) state = reduce(state, event);
  return state;
}

function openWorkflowWithTeamStep(): StreamEvent[] {
  return [
    ev("WorkflowStarted", {
      workflow_id: "wf-1",
      workflow_name: "WF One",
      run_id: "run-WF",
      session_id: "sess-W",
    }),
    ev("StepStarted", { ...STEP, step_index: 0 }),
    ev("TeamRunStarted", {
      ...STEP,
      team_id: "team-X",
      team_name: "Team X",
      run_id: "run-TEAM",
      session_id: "sess-T",
    }),
  ];
}

describe("team executor inside a workflow", () => {
  it("TeamRunStarted records the executor on the step, never the run keys", () => {
    const state = runSequence(openWorkflowWithTeamStep());
    expect(state.runId).toBe("run-WF");
    expect(state.sessionId).toBe("sess-W");
    expect(state.header?.entityName).toBe("WF One");
    expect(state.status).toBe("running");
    const step = state.blocks.find((b): b is StepBlock => b.kind === "step");
    expect(step?.executorName).toBe("Team X");
  });

  it("leader TeamRunContent renders inside the step block", () => {
    const state = runSequence([
      ...openWorkflowWithTeamStep(),
      ev("TeamRunContent", { ...STEP, team_id: "team-X", content: "leader text" }),
    ]);
    const step = state.blocks.find((b): b is StepBlock => b.kind === "step")!;
    const text = state.blocks.find((b): b is TextBlock => b.kind === "text")!;
    expect(text.parentId).toBe(step.id);
    expect(text.text).toBe("leader text");
  });

  it("member blocks nest in the step, upgrade on RunStarted, and receive member content", () => {
    let state = runSequence([
      ...openWorkflowWithTeamStep(),
      ev("TeamToolCallStarted", {
        ...STEP,
        tool: {
          tool_call_id: "tc-d1",
          tool_name: "delegate_task_to_member",
          tool_args: { member_id: "mem-1", task: "summarize" },
          created_at: clock,
        },
      }),
    ]);
    const step = state.blocks.find((b): b is StepBlock => b.kind === "step")!;
    let member = state.blocks.find((b): b is MemberBlock => b.kind === "member")!;
    expect(member.parentId).toBe(step.id);
    expect(member.name).toBe("mem-1");

    state = reduce(
      state,
      ev("RunStarted", {
        ...STEP,
        agent_id: "agent-M",
        agent_name: "Member Agent",
        run_id: "run-M",
      }),
    );
    member = state.blocks.find((b): b is MemberBlock => b.kind === "member")!;
    expect(member.name).toBe("Member Agent");
    expect(member.memberId).toBe("agent-M");
    // The step executor name must NOT be clobbered by the member.
    const stepAfter = state.blocks.find((b): b is StepBlock => b.kind === "step")!;
    expect(stepAfter.executorName).toBe("Team X");
    // Run keys untouched by the member's RunStarted.
    expect(state.runId).toBe("run-WF");

    state = reduce(
      state,
      ev("RunContent", { ...STEP, agent_id: "agent-M", run_id: "run-M", content: "member says hi" }),
    );
    const memberText = state.blocks.find(
      (b): b is TextBlock => b.kind === "text" && b.parentId === member.id,
    );
    expect(memberText?.text).toBe("member says hi");

    // Member RunCompleted is a NO-OP; TeamToolCallCompleted closes the block.
    const afterMemberDone = reduce(
      state,
      ev("RunCompleted", { ...STEP, agent_id: "agent-M", run_id: "run-M", content: "member says hi" }),
    );
    expect(afterMemberDone).toBe(state);
    state = reduce(
      state,
      ev("TeamToolCallCompleted", {
        ...STEP,
        tool: {
          tool_call_id: "tc-d1",
          tool_name: "delegate_task_to_member",
          tool_args: { member_id: "mem-1", task: "summarize" },
          result: "done",
          created_at: clock,
        },
      }),
    );
    const closed = state.blocks.find((b): b is MemberBlock => b.kind === "member")!;
    expect(closed.open).toBe(false);
    expect(closed.status).toBe("completed");
  });

  it("nested TeamRunCompleted is a NO-OP for run state (step closes on StepCompleted)", () => {
    const before = runSequence([
      ...openWorkflowWithTeamStep(),
      ev("TeamRunContent", { ...STEP, content: "text" }),
    ]);
    const after = reduce(
      before,
      ev("TeamRunCompleted", {
        ...STEP,
        team_id: "team-X",
        run_id: "run-TEAM",
        content: "team summary",
        metrics: { input_tokens: 5, output_tokens: 5 },
      }),
    );
    expect(after).toBe(before);
    expect(after.status).toBe("running");
    expect(after.runCompleted).toBe(false);
    expect(after.metrics).toBeNull();
  });

  it("nested TeamRunError renders inside the step without ending the run", () => {
    const state = runSequence([
      ...openWorkflowWithTeamStep(),
      ev("TeamRunError", { ...STEP, team_id: "team-X", content: "member exploded" }),
    ]);
    const step = state.blocks.find((b): b is StepBlock => b.kind === "step")!;
    const error = state.blocks.find((b) => b.kind === "error");
    expect(error?.parentId).toBe(step.id);
    expect(state.status).toBe("running");
    expect(state.runCompleted).toBe(false);
    expect(state.error).toBeNull();
  });

  it("the workflow still completes normally after a team step", () => {
    const state = runSequence([
      ...openWorkflowWithTeamStep(),
      ev("TeamRunCompleted", { ...STEP, team_id: "team-X", run_id: "run-TEAM" }),
      ev("StepCompleted", {
        ...STEP,
        step_response: { duration: 1.5, success: true },
      }),
      ev("WorkflowCompleted", { workflow_id: "wf-1", run_id: "run-WF" }),
    ]);
    const step = state.blocks.find((b): b is StepBlock => b.kind === "step")!;
    expect(step.open).toBe(false);
    expect(step.durationSeconds).toBe(1.5);
    expect(state.status).toBe("completed");
    expect(state.runCompleted).toBe(true);
  });

  it("plain team chats are unaffected: TeamRunStarted with no steps owns the run", () => {
    const state = runSequence([
      ev("TeamRunStarted", {
        team_id: "team-X",
        team_name: "Team X",
        run_id: "run-T",
        session_id: "sess-T",
      }),
    ]);
    expect(state.runId).toBe("run-T");
    expect(state.header?.entityName).toBe("Team X");
  });

  it("TeamRunPaused routes like RunPaused (forward compat)", () => {
    const state = runSequence([
      ev("TeamRunStarted", { team_id: "team-X", run_id: "run-T", session_id: "sess-T" }),
      ev("TeamRunPaused", {
        team_id: "team-X",
        run_id: "run-T",
        session_id: "sess-T",
        requirements: [
          {
            id: "req-1",
            created_at: "2026-06-11T00:00:00Z",
            tool_execution: {
              tool_call_id: "tc-1",
              tool_name: "gated",
              tool_args: {},
              requires_confirmation: true,
              confirmed: null,
              confirmation_note: null,
            },
          },
        ],
      }),
    ]);
    expect(state.status).toBe("paused");
    expect(state.runCompleted).toBe(true);
    expect(state.paused?.toolExecutions).toHaveLength(1);
  });
});
