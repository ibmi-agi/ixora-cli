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

  it("a sub-team member (team within a team) never clobbers the top run", () => {
    let state = runSequence([
      ev("TeamRunStarted", {
        team_id: "team-TOP",
        team_name: "Top Team",
        run_id: "run-TOP",
        session_id: "sess-TOP",
      }),
      ev("TeamToolCallStarted", {
        team_id: "team-TOP",
        run_id: "run-TOP",
        tool: {
          tool_call_id: "tc-sub",
          tool_name: "delegate_task_to_member",
          tool_args: { member_id: "sub-team", task: "investigate" },
          created_at: clock,
        },
      }),
      // The sub-team's own Team* events, forwarded in the parent stream:
      ev("TeamRunStarted", {
        team_id: "team-SUB",
        team_name: "Sub Team",
        run_id: "run-SUB",
        session_id: "sess-SUB",
      }),
      ev("TeamRunContent", { team_id: "team-SUB", run_id: "run-SUB", content: "sub-leader text" }),
    ]);
    // Top run keys intact; member block upgraded to the sub-team's name.
    expect(state.runId).toBe("run-TOP");
    expect(state.header?.entityName).toBe("Top Team");
    const member = state.blocks.find((b): b is MemberBlock => b.kind === "member")!;
    expect(member.name).toBe("Sub Team");
    expect(member.open).toBe(true);
    // Sub-leader content renders INSIDE the member block.
    const text = state.blocks.find(
      (b): b is TextBlock => b.kind === "text" && b.parentId === member.id,
    );
    expect(text?.text).toBe("sub-leader text");

    // Sub-team completion never flips top status/metrics.
    const afterSubDone = reduce(
      state,
      ev("TeamRunCompleted", {
        team_id: "team-SUB",
        run_id: "run-SUB",
        content: "sub summary",
        metrics: { input_tokens: 1 },
      }),
    );
    expect(afterSubDone).toBe(state);
    expect(afterSubDone.status).toBe("running");
    expect(afterSubDone.runCompleted).toBe(false);

    // Top leader resumes: member closes, content at top level.
    state = reduce(
      afterSubDone,
      ev("TeamRunContent", { team_id: "team-TOP", run_id: "run-TOP", content: "top resumes" }),
    );
    const closedMember = state.blocks.find((b): b is MemberBlock => b.kind === "member")!;
    expect(closedMember.open).toBe(false);
    const topText = state.blocks.find(
      (b): b is TextBlock => b.kind === "text" && b.parentId === null && b.text === "top resumes",
    );
    expect(topText).toBeDefined();
  });

  it("parallel team-steps: member events route to the member inside the matched step", () => {
    let state = runSequence([
      ev("WorkflowStarted", { workflow_id: "wf-1", workflow_name: "WF One", run_id: "run-WF" }),
      ev("ParallelExecutionStarted", { workflow_id: "wf-1", parallel_step_count: 2 }),
      ev("StepStarted", { workflow_id: "wf-1", step_id: "s1", step_name: "step-a", step_index: [0, 0] }),
      ev("StepStarted", { workflow_id: "wf-1", step_id: "s2", step_name: "step-b", step_index: [0, 1] }),
      ev("TeamRunStarted", { workflow_id: "wf-1", step_id: "s1", team_id: "team-A", team_name: "Team A", run_id: "run-TA" }),
      ev("TeamRunStarted", { workflow_id: "wf-1", step_id: "s2", team_id: "team-B", team_name: "Team B", run_id: "run-TB" }),
      ev("TeamToolCallStarted", {
        workflow_id: "wf-1",
        step_id: "s1",
        tool: { tool_call_id: "tc-a", tool_name: "delegate_task_to_member", tool_args: { member_id: "alpha", task: "t" }, created_at: clock },
      }),
      ev("TeamToolCallStarted", {
        workflow_id: "wf-1",
        step_id: "s2",
        tool: { tool_call_id: "tc-b", tool_name: "delegate_task_to_member", tool_args: { member_id: "beta", task: "t" }, created_at: clock },
      }),
      // alpha's RunStarted: agent_id doesn't match the slug, the positional
      // pointer references beta — must still land on s1's member.
      ev("RunStarted", { workflow_id: "wf-1", step_id: "s1", agent_id: "agent-alpha", agent_name: "Alpha Agent", run_id: "run-A" }),
    ]);
    const steps = state.blocks.filter((b): b is StepBlock => b.kind === "step");
    const s1 = steps.find((b) => b.stepId === "s1")!;
    expect(s1.executorName).toBe("Team A"); // not clobbered by the member
    const members = state.blocks.filter((b): b is MemberBlock => b.kind === "member");
    const alpha = members.find((b) => b.parentId === s1.id)!;
    expect(alpha.name).toBe("Alpha Agent"); // upgraded in the right step

    state = reduce(
      state,
      ev("RunContent", { workflow_id: "wf-1", step_id: "s1", agent_id: "agent-alpha", run_id: "run-A", content: "alpha says" }),
    );
    const text = state.blocks.find(
      (b): b is TextBlock => b.kind === "text" && b.text === "alpha says",
    );
    expect(text?.parentId).toBe(alpha.id);
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

  it("late TeamRunCompleted after its step closed never flips top state", () => {
    const before = runSequence([
      ...openWorkflowWithTeamStep(),
      ev("TeamRunContent", { ...STEP, content: "text" }),
      ev("StepCompleted", { ...STEP, step_response: { duration: 1, success: true } }),
    ]);
    const after = reduce(
      before,
      ev("TeamRunCompleted", {
        ...STEP,
        team_id: "team-X",
        run_id: "run-TEAM",
        content: "late summary",
        metrics: { input_tokens: 5 },
      }),
    );
    expect(after).toBe(before);
    expect(after.status).toBe("running");
    expect(after.metrics).toBeNull();
  });

  it("nested TeamRunCancelled never cancels the top run", () => {
    const before = runSequence(openWorkflowWithTeamStep());
    const after = reduce(
      before,
      ev("TeamRunCancelled", { ...STEP, team_id: "team-X", run_id: "run-TEAM" }),
    );
    expect(after).toBe(before);
    expect(after.status).toBe("running");
    expect(after.runCompleted).toBe(false);
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
