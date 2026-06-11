// Reducer contract tests: replay all 9 SSE fixtures through the real SDK
// parser (tests/chat/helpers.ts) and assert the resulting block structures.

import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@worksofadam/agentos-sdk";
import { replayFixture } from "./helpers.js";
import {
  createInitialState,
  finalizeTranscript,
  reduce,
  summarizeArgs,
} from "../../src/lib/chat/reducer.js";
import type {
  Block,
  MemberBlock,
  TextBlock,
  TranscriptState,
} from "../../src/lib/chat/types.js";

function reduceAll(events: StreamEvent[]): TranscriptState {
  return events.reduce(reduce, createInitialState());
}

/** states[0] = initial; states[i + 1] = state after events[i]. */
function reduceTrace(
  events: StreamEvent[],
  initial: TranscriptState = createInitialState(),
): TranscriptState[] {
  const states: TranscriptState[] = [initial];
  for (const event of events) {
    states.push(reduce(states[states.length - 1], event));
  }
  return states;
}

function byKind<K extends Block["kind"]>(
  state: TranscriptState,
  kind: K,
): Extract<Block, { kind: K }>[] {
  return state.blocks.filter(
    (b): b is Extract<Block, { kind: K }> => b.kind === kind,
  );
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
}

// ---------------------------------------------------------------------------
// simple-run
// ---------------------------------------------------------------------------

describe("simple-run", () => {
  it("appends deltas into one text block, closes it, captures metrics + header", async () => {
    const events = await replayFixture("simple-run");
    const state = reduceAll(events);

    expect(state.runId).toBe("run-R1");
    expect(state.sessionId).toBe("sess-S1");
    expect(state.agentId).toBe("agent-one");
    expect(state.header).toEqual({
      entityId: "agent-one",
      entityName: "Agent One",
      model: "claude-sonnet-4-6",
      modelProvider: "Anthropic",
    });

    const texts = byKind(state, "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("Hello, this is a simple run.");
    expect(texts[0].open).toBe(false);
    expect(texts[0].parentId).toBeNull();
    // created_at is unix SECONDS on the wire; blocks surface MILLISECONDS.
    expect(texts[0].createdAtMs).toBe(1781179201000);

    expect(state.metrics).toEqual({
      input_tokens: 120,
      output_tokens: 34,
      total_tokens: 154,
      duration: 2.31,
      time_to_first_token: 0.42,
    });
    expect(state.status).toBe("completed");
    expect(state.runCompleted).toBe(true);
    expect(state.paused).toBeNull();
    expect(state.error).toBeNull();
  });

  it("routes reasoning_content into a separate reasoning lane keyed by run", async () => {
    const events = await replayFixture("simple-run");
    const state = reduceAll(events);
    const reasoning = byKind(state, "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].key).toBe("run-R1:reasoning");
    expect(reasoning[0].text).toBe(
      "The user greeted me; a short reply is enough.",
    );
  });

  it("ignores unknown events and post-completion noise (same state reference)", async () => {
    const events = await replayFixture("simple-run");
    const names = events.map((e) => e.event);
    const states = reduceTrace(events);

    // Unknown wire-only event: state unchanged by reference.
    const unknownIdx = names.indexOf("ModelRequestStarted");
    expect(states[unknownIdx + 1]).toBe(states[unknownIdx]);

    // Trailing MemoryUpdateStarted/Completed after RunCompleted: ignored.
    const completedIdx = names.indexOf("RunCompleted");
    expect(states[states.length - 1]).toBe(states[completedIdx + 1]);
  });
});

// ---------------------------------------------------------------------------
// tool-run
// ---------------------------------------------------------------------------

describe("tool-run", () => {
  it("closes the text block before the tool row and completes the row in place", async () => {
    const events = await replayFixture("tool-run");
    const names = events.map((e) => e.event);
    const states = reduceTrace(events);
    const state = states[states.length - 1];

    // Block order: text, tool, text.
    expect(state.blocks.map((b) => b.kind)).toEqual(["text", "tool", "text"]);

    // At ToolCallStarted time: text closed FIRST, row running.
    const startIdx = names.indexOf("ToolCallStarted");
    const atStart = states[startIdx + 1];
    const [text1] = byKind(atStart, "text");
    expect(text1.open).toBe(false);
    expect(text1.text).toBe("Let me look that up.");
    const [runningRow] = byKind(atStart, "tool");
    expect(runningRow.status).toBe("running");
    expect(runningRow.toolCallId).toBe("tc-a1");
    expect(runningRow.argsSummary).toBe('system="DEV1"');

    // In-place completion keyed by tool_call_id: still exactly one row.
    const rows = byKind(state, "tool");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(runningRow.id);
    expect(rows[0].status).toBe("success");
    expect(rows[0].durationSeconds).toBe(0.42);
    expect(rows[0].result).toBe("CPU 12%, 3 active jobs, no MSGW");
    expect(rows[0].open).toBe(false);

    const texts = byKind(state, "text");
    expect(texts[1].text).toBe(" DEV1 looks healthy: CPU at 12%.");
    expect(texts[1].open).toBe(false);
    expect(state.status).toBe("completed");
    expect(state.metrics?.total_tokens).toBe(268);
  });
});

// ---------------------------------------------------------------------------
// multi-tool-pause
// ---------------------------------------------------------------------------

describe("multi-tool-pause", () => {
  it("captures pausedState from requirements (preferred over tools fallback)", async () => {
    const events = await replayFixture("multi-tool-pause");
    const state = reduceAll(events);

    expect(state.status).toBe("paused");
    // RunPaused is stream-terminal: suppress cancel-on-abort.
    expect(state.runCompleted).toBe(true);

    expect(state.paused).not.toBeNull();
    const paused = state.paused!;
    expect(paused.runId).toBe("run-R3");
    expect(paused.sessionId).toBe("sess-S3");
    expect(paused.agentId).toBe("agent-one");
    expect(paused.source).toBe("requirements");
    expect(paused.requirements).toHaveLength(2);
    expect(paused.tools).toHaveLength(2);
    // Two prompts from one pause: one normalized entry per requirement.
    expect(paused.toolExecutions.map((t) => t.tool_call_id)).toEqual([
      "tc-h1",
      "tc-h2",
    ]);
    for (const exec of paused.toolExecutions) {
      expect(exec.requires_confirmation).toBe(true);
      expect(exec.confirmed).toBeNull();
      expect(exec.confirmation_note).toBeNull();
    }

    // Preamble text was flushed/closed by the pause.
    const texts = byKind(state, "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].open).toBe(false);

    // Nothing left open at stream end — finalize is a no-op (same reference).
    expect(finalizeTranscript(state)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// approve-repause-approve
// ---------------------------------------------------------------------------

describe("approve-repause-approve", () => {
  it("re-pause inside a continue stream is captured with fresh requirements", async () => {
    const part1 = await replayFixture("approve-repause-approve.1");
    const part2 = await replayFixture("approve-repause-approve.2");
    const part3 = await replayFixture("approve-repause-approve.3");

    const afterPart1 = reduceAll(part1);
    expect(afterPart1.status).toBe("paused");
    expect(afterPart1.runCompleted).toBe(true);
    expect(afterPart1.paused?.toolExecutions.map((t) => t.tool_call_id)).toEqual(
      ["tc-h3"],
    );

    // RunContinued re-arms the stream: cancellable again, pause consumed.
    const trace2 = reduceTrace(part2, afterPart1);
    const afterContinued = trace2[1];
    expect(part2[0].event).toBe("RunContinued");
    expect(afterContinued.status).toBe("running");
    expect(afterContinued.runCompleted).toBe(false);
    expect(afterContinued.paused).toBeNull();
    expect(afterContinued.statusLine).toBe("continuing...");

    // Second pause (openagent defect A): captured, with a FRESH tool_call_id
    // and invariant run/session ids.
    const afterPart2 = trace2[trace2.length - 1];
    expect(afterPart2.status).toBe("paused");
    expect(afterPart2.runCompleted).toBe(true);
    expect(afterPart2.paused?.toolExecutions.map((t) => t.tool_call_id)).toEqual(
      ["tc-h4"],
    );
    expect(afterPart2.paused?.runId).toBe("run-R4");
    expect(afterPart2.paused?.sessionId).toBe("sess-S4");
    expect(afterPart2.runId).toBe("run-R4");
    expect(afterPart2.sessionId).toBe("sess-S4");

    const final = part3.reduce(reduce, afterPart2);
    expect(final.status).toBe("completed");
    expect(final.runCompleted).toBe(true);
    expect(final.paused).toBeNull();
    expect(final.metrics?.total_tokens).toBe(636);

    // Both gated tools rendered as completed rows across the rounds.
    const rows = byKind(final, "tool");
    expect(rows.map((r) => r.toolCallId)).toEqual(["tc-h3", "tc-h4"]);
    expect(rows.map((r) => r.status)).toEqual(["success", "success"]);
    expect(rows.map((r) => r.durationSeconds)).toEqual([0.31, 0.55]);

    const texts = byKind(final, "text");
    expect(texts.map((t) => t.text)).toEqual([
      "First I will update the config.",
      "Config updated. Next I need to start the subsystem.",
      "Both operations are done.",
    ]);
    expect(texts.every((t) => !t.open)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reject-with-note
// ---------------------------------------------------------------------------

describe("reject-with-note", () => {
  it("pause captured; continue-after-reject stream reaches a terminal state", async () => {
    const part1 = await replayFixture("reject-with-note.1");
    const part2 = await replayFixture("reject-with-note.2");

    const afterPart1 = reduceAll(part1);
    expect(afterPart1.status).toBe("paused");
    expect(afterPart1.paused?.source).toBe("requirements");
    expect(afterPart1.paused?.toolExecutions).toHaveLength(1);
    expect(afterPart1.paused?.toolExecutions[0].tool_call_id).toBe("tc-h5");
    expect(afterPart1.paused?.toolExecutions[0].confirmed).toBeNull();

    // Openagent defect B locked in upstream: continue IS sent on all-rejected
    // (see fixtures.test.ts for the recorded request body); the reducer must
    // carry the continue stream to completion with no tool row.
    const final = part2.reduce(reduce, afterPart1);
    expect(final.status).toBe("completed");
    expect(final.runCompleted).toBe(true);
    expect(final.paused).toBeNull();
    expect(byKind(final, "tool")).toHaveLength(0);
    const texts = byKind(final, "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toContain("do not run this on PROD");
    expect(final.metrics?.total_tokens).toBe(351);
  });
});

// ---------------------------------------------------------------------------
// team-two-members
// ---------------------------------------------------------------------------

describe("team-two-members", () => {
  it("opens member blocks on delegation, upgrades titles, closes only on TeamToolCallCompleted", async () => {
    const events = await replayFixture("team-two-members");
    const names = events.map((e) => e.event);
    const states = reduceTrace(events);
    const state = states[states.length - 1];

    expect(state.runId).toBe("run-R6");
    expect(state.teamId).toBe("team-one");
    expect(state.header?.entityName).toBe("Team One");

    // Provisional member_id title on delegation...
    const delegateIdx = names.indexOf("TeamToolCallStarted");
    const provisional = byKind(states[delegateIdx + 1], "member")[0];
    expect(provisional.name).toBe("member-one");
    expect(provisional.memberId).toBe("member-one");
    expect(provisional.task).toBe("Check system status");
    expect(provisional.status).toBe("running");
    // ...UPGRADED in place by the member's RunStarted.
    const upgradeIdx = names.indexOf("RunStarted");
    const upgraded = byKind(states[upgradeIdx + 1], "member")[0];
    expect(upgraded.id).toBe(provisional.id);
    expect(upgraded.name).toBe("Agent One");
    expect(upgraded.memberId).toBe("agent-one");

    // Member RunCompleted is a NO-OP (same state reference, block stays open).
    const memberCompletedIdx = names.indexOf("RunCompleted");
    expect(states[memberCompletedIdx + 1]).toBe(states[memberCompletedIdx]);
    expect(byKind(states[memberCompletedIdx + 1], "member")[0].open).toBe(true);

    // Only TeamToolCallCompleted closes the delegation.
    const closeIdx = names.indexOf("TeamToolCallCompleted");
    const closed = byKind(states[closeIdx + 1], "member")[0];
    expect(closed.open).toBe(false);
    expect(closed.status).toBe("completed");

    // Final shape: two member blocks, both closed.
    const members = byKind(state, "member");
    expect(members.map((m) => m.name)).toEqual(["Agent One", "Agent Two"]);
    expect(members.every((m) => !m.open && m.status === "completed")).toBe(
      true,
    );

    // Member 1 children: two text blocks + one tool row, all inside the block.
    const member1 = members[0];
    const children = state.blocks.filter((b) => b.parentId === member1.id);
    expect(children.map((b) => b.kind)).toEqual(["text", "tool", "text"]);
    const [mText1, mTool, mText2] = children;
    expect(mText1.kind === "text" && mText1.text).toBe(
      "Checking the system status now.",
    );
    expect(mText2.kind === "text" && mText2.text).toBe(" DEV1 is healthy.");
    if (mTool.kind !== "tool") throw new Error("expected tool row");
    expect(mTool.toolCallId).toBe("tc-m1");
    expect(mTool.status).toBe("success");
    expect(mTool.durationSeconds).toBe(0.62);

    // Leader text: intro before delegation + synthesis after, both top-level.
    const leaderTexts = byKind(state, "text").filter(
      (b) => b.parentId === null,
    );
    expect(leaderTexts.map((t) => t.text)).toEqual([
      "I will delegate this to two members.",
      " Summary: DEV1 is healthy and recent jobs are clean.",
    ]);

    expect(state.memberResponses).toHaveLength(2);
    expect(state.metrics?.total_tokens).toBe(1020);
    expect(state.status).toBe("completed");
  });

  it("TeamRunContent while a member block is open = leader resume (closes the member)", async () => {
    const events = await replayFixture("team-two-members");
    const names = events.map((e) => e.event);
    const states = reduceTrace(events);

    // State right after member-1's RunCompleted: member block still open.
    const midState = states[names.indexOf("RunCompleted") + 1];
    expect(byKind(midState, "member")[0].open).toBe(true);

    // Apply the leader-synthesis TeamRunContent directly (out of order).
    const synthesis = events[names.lastIndexOf("TeamRunContent")];
    const resumed = reduce(midState, synthesis);
    const member = byKind(resumed, "member")[0];
    expect(member.open).toBe(false);
    expect(member.status).toBe("completed");

    // The member's open text was flushed; a fresh LEADER text block is open.
    const openText = resumed.blocks.find(
      (b) => b.id === resumed.openTextBlockId,
    ) as TextBlock;
    expect(openText.parentId).toBeNull();
    expect(openText.text).toBe(
      " Summary: DEV1 is healthy and recent jobs are clean.",
    );
  });
});

// ---------------------------------------------------------------------------
// workflow-steps
// ---------------------------------------------------------------------------

describe("workflow-steps", () => {
  it("opens step blocks, routes nested agent events by step_id, renders tuple indexes", async () => {
    const events = await replayFixture("workflow-steps");
    const names = events.map((e) => e.event);
    const states = reduceTrace(events);
    const state = states[states.length - 1];

    expect(state.workflowId).toBe("wf-one");
    expect(state.header?.entityName).toBe("Workflow One");
    // Nested executor RunStarted must NOT overwrite the workflow's run keys.
    expect(state.runId).toBe("run-R7");
    expect(state.sessionId).toBe("sess-S7");

    const steps = byKind(state, "step");
    expect(steps).toHaveLength(2);
    const [step1, step2] = steps;

    expect(step1.stepId).toBe("step-id-1");
    expect(step1.stepName).toBe("step-1");
    expect(step1.stepIndexLabel).toBe("0");
    expect(step1.parentId).toBeNull();
    expect(step1.executorName).toBe("Agent One");
    expect(step1.open).toBe(false);
    expect(step1.durationSeconds).toBe(1.2);
    expect(step1.metrics?.total_tokens).toBe(74);
    expect(step1.output).toEqual({
      content: "Analyzing the input for step one.",
      success: true,
      error: undefined,
      stop: undefined,
    });

    // Nested deltas landed INSIDE step 1.
    const step1Texts = byKind(state, "text").filter(
      (b) => b.parentId === step1.id,
    );
    expect(step1Texts).toHaveLength(1);
    expect(step1Texts[0].text).toBe("Analyzing the input for step one.");
    expect(step1Texts[0].open).toBe(false);

    // Nested RunCompleted is a no-op: the run is not terminal mid-workflow.
    const nestedCompletedIdx = names.indexOf("RunCompleted");
    expect(states[nestedCompletedIdx + 1]).toBe(states[nestedCompletedIdx]);
    expect(states[nestedCompletedIdx + 1].runCompleted).toBe(false);

    // Parallel group wraps step 2; tuple step_index renders group.position.
    const [group] = byKind(state, "group");
    expect(group.groupType).toBe("parallel");
    expect(group.meta.parallel_step_count).toBe(2);
    expect(group.open).toBe(false);
    expect(Array.isArray(group.meta.step_results)).toBe(true);

    expect(step2.parentId).toBe(group.id);
    expect(step2.stepIndex).toEqual([1, 0]);
    expect(step2.stepIndexLabel).toBe("1.0");
    expect(step2.executorName).toBe("Agent Two");
    expect(step2.durationSeconds).toBe(0.8);
    const step2Texts = byKind(state, "text").filter(
      (b) => b.parentId === step2.id,
    );
    expect(step2Texts.map((t) => t.text)).toEqual(["Step two done."]);

    expect(state.status).toBe("completed");
    expect(state.runCompleted).toBe(true);
    expect(state.workflowStack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// run-error
// ---------------------------------------------------------------------------

describe("run-error", () => {
  it("flushes partial text and renders an error banner from content", async () => {
    const events = await replayFixture("run-error");
    const state = reduceAll(events);

    expect(state.blocks.map((b) => b.kind)).toEqual(["text", "error"]);
    const [text] = byKind(state, "text");
    expect(text.text).toBe("Starting the operation");
    expect(text.open).toBe(false);

    const [error] = byKind(state, "error");
    expect(error.message).toBe(
      "Tool execution failed: connection to DEV1 timed out",
    );
    expect(state.error).toBe(error.message);
    expect(state.status).toBe("error");
    expect(state.runCompleted).toBe(true);
    // No RunCompleted: no metrics footer.
    expect(state.metrics).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cancelled-run
// ---------------------------------------------------------------------------

describe("cancelled-run", () => {
  it("preserves partial text and renders the cancellation with its reason", async () => {
    const events = await replayFixture("cancelled-run");
    const state = reduceAll(events);

    expect(state.blocks.map((b) => b.kind)).toEqual(["text", "cancelled"]);
    const [text] = byKind(state, "text");
    expect(text.text).toBe("Working on the first part of the answer");
    expect(text.open).toBe(false);

    const [cancelled] = byKind(state, "cancelled");
    expect(cancelled.reason).toBe("cancelled by user");
    expect(state.status).toBe("cancelled");
    // Guard: the run is already terminal — Esc must not double-cancel.
    expect(state.runCompleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stream-end invariant + purity
// ---------------------------------------------------------------------------

describe("finalizeTranscript (stream-end invariant)", () => {
  it("closes all open blocks exactly once (idempotent by reference)", async () => {
    // Truncated stream: RunStarted + two deltas, no terminal event.
    const events = (await replayFixture("cancelled-run")).slice(0, 3);
    const state = reduceAll(events);
    expect(state.openTextBlockId).not.toBeNull();

    const finalized = finalizeTranscript(state);
    expect(finalized.openTextBlockId).toBeNull();
    expect(finalized.blocks.every((b) => !b.open)).toBe(true);
    // Second call: nothing to do — SAME reference.
    expect(finalizeTranscript(finalized)).toBe(finalized);
  });

  it("closes a reasoning lane left open by a stream without ReasoningCompleted", async () => {
    const events = await replayFixture("simple-run");
    const state = reduceAll(events);
    const [reasoning] = byKind(state, "reasoning");
    expect(reasoning.open).toBe(true);

    const finalized = finalizeTranscript(state);
    expect(byKind(finalized, "reasoning")[0].open).toBe(false);
    expect(finalizeTranscript(finalized)).toBe(finalized);
  });
});

describe("reduce purity", () => {
  const fixtures = [
    "simple-run",
    "tool-run",
    "multi-tool-pause",
    "team-two-members",
    "workflow-steps",
    "run-error",
    "cancelled-run",
  ];

  for (const fixture of fixtures) {
    it(`${fixture}: never mutates input state or events (deep-frozen replay)`, async () => {
      const events = await replayFixture(fixture);
      let state = createInitialState();
      for (const event of events) {
        deepFreeze(state);
        deepFreeze(event);
        state = reduce(state, event);
      }
      deepFreeze(state);
      expect(() => finalizeTranscript(state)).not.toThrow();
    });
  }

  it("approve-repause-approve: frozen replay across all three parts", async () => {
    const events = [
      ...(await replayFixture("approve-repause-approve.1")),
      ...(await replayFixture("approve-repause-approve.2")),
      ...(await replayFixture("approve-repause-approve.3")),
    ];
    let state = createInitialState();
    for (const event of events) {
      deepFreeze(state);
      deepFreeze(event);
      state = reduce(state, event);
    }
    expect(state.status).toBe("completed");
  });
});

describe("summarizeArgs", () => {
  it("JSON-stringifies values and truncates each to 50 chars", () => {
    expect(summarizeArgs({ system: "DEV1", limit: 5 })).toBe(
      'system="DEV1", limit=5',
    );
    const long = summarizeArgs({ statement: "x".repeat(100) });
    expect(long).toBe(`statement="${"x".repeat(46)}...`);
    expect(long.length).toBe("statement=".length + 50);
  });
});
