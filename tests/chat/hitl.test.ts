import { describe, it, expect, vi } from "vitest";
import type { StreamEvent } from "@worksofadam/agentos-sdk";
import { replayFixture, loadRequestFixture } from "./helpers.js";
import {
  buildDecisionPayload,
  capturePause,
  pendingToolExecutions,
  runHitlLoop,
  type CapturedPause,
  type ContinueRunOptions,
  type HitlDecision,
  type ToolExecution,
} from "../../src/lib/chat/hitl.js";

/** Replay a fixture and capture its RunPaused the way the runner would. */
async function pauseFromFixture(
  name: string,
  entityId: string,
): Promise<CapturedPause> {
  const events = await replayFixture(name);
  const started = events.find((e) => e.event === "RunStarted");
  const paused = events.find((e) => e.event === "RunPaused");
  if (!paused) throw new Error(`fixture ${name} has no RunPaused event`);
  return capturePause(paused, {
    entityId,
    runId: started?.run_id,
    sessionId: started?.["session_id"] as string | undefined,
  });
}

/** Reduce callback that replays a continue-stream fixture (by token). */
function reduceFromFixtures(tokenToFixture: Record<string, string>) {
  return async (stream: unknown): Promise<CapturedPause | null> => {
    const name = tokenToFixture[stream as string];
    if (!name) throw new Error(`unexpected continue stream token: ${String(stream)}`);
    const events = await replayFixture(name);
    const paused = events.find((e) => e.event === "RunPaused");
    return paused ? capturePause(paused, { entityId: "agent-one" }) : null;
  };
}

function toolExecution(overrides: Partial<ToolExecution>): ToolExecution {
  return {
    tool_call_id: "tc-x",
    tool_name: "run_sql_statement",
    tool_args: { statement: "VALUES 1" },
    requires_confirmation: true,
    confirmed: null,
    confirmation_note: null,
    ...overrides,
  };
}

function pausedEvent(fields: Record<string, unknown>): StreamEvent {
  return { event: "RunPaused", created_at: 1781179200, ...fields };
}

describe("capturePause", () => {
  it("prefers requirements[] over tools[] when both are present", () => {
    const pause = capturePause(
      pausedEvent({
        run_id: "run-X",
        session_id: "sess-X",
        requirements: [
          {
            id: "req-x",
            created_at: "2026-06-10T12:00:00Z",
            tool_execution: toolExecution({ tool_call_id: "tc-from-req" }),
          },
        ],
        tools: [toolExecution({ tool_call_id: "tc-from-tools" })],
      }),
      { entityId: "agent-one" },
    );
    const pending = pendingToolExecutions(pause);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.tool_call_id).toBe("tc-from-req");
  });

  it("falls back to tools[] when requirements[] is absent", () => {
    const pause = capturePause(
      pausedEvent({
        run_id: "run-X",
        session_id: "sess-X",
        tools: [toolExecution({ tool_call_id: "tc-from-tools" })],
      }),
      { entityId: "agent-one" },
    );
    const pending = pendingToolExecutions(pause);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.tool_call_id).toBe("tc-from-tools");
  });

  it("treats empty session_id as missing (never '')", () => {
    const pause = capturePause(
      pausedEvent({ run_id: "run-X", session_id: "", requirements: [] }),
      { entityId: "agent-one", sessionId: "" },
    );
    expect(pause.sessionId).toBeNull();
  });
});

describe("runHitlLoop", () => {
  it("prompts once per requirement and sends all answers in ONE continue", async () => {
    const pause = await pauseFromFixture("multi-tool-pause", "agent-one");
    expect(pause.runId).toBe("run-R3");
    expect(pause.sessionId).toBe("sess-S3");
    expect(pause.requirements).toHaveLength(2);

    const prompted: string[] = [];
    const decide = vi.fn(async (te: ToolExecution): Promise<HitlDecision> => {
      prompted.push(te.tool_call_id);
      return te.tool_call_id === "tc-h1"
        ? { approve: true }
        : { approve: false, note: "leave QBATCH alone" };
    });
    const continueRun = vi.fn(
      async (_runId: string, _opts: ContinueRunOptions) => "stream-1",
    );

    const result = await runHitlLoop({
      pause,
      decide,
      continueRun,
      reduceContinueStream: async () => null,
    });

    expect(prompted).toEqual(["tc-h1", "tc-h2"]);
    expect(continueRun).toHaveBeenCalledTimes(1);
    const [runId, opts] = continueRun.mock.calls[0]!;
    expect(runId).toBe("run-R3");
    expect(opts.sessionId).toBe("sess-S3");
    expect(opts.stream).toBe(true);
    const tools = JSON.parse(opts.tools) as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      tool_call_id: "tc-h1",
      confirmed: true,
      confirmation_note: null,
    });
    expect(tools[1]).toMatchObject({
      tool_call_id: "tc-h2",
      confirmed: false,
      confirmation_note: "leave QBATCH alone",
    });
    expect(result.rounds).toBe(1);
  });

  it("re-enters the loop on a RunPaused inside the continue stream (defect A)", async () => {
    const pause = await pauseFromFixture("approve-repause-approve.1", "agent-one");
    expect(pause.runId).toBe("run-R4");
    expect(pause.sessionId).toBe("sess-S4");

    const decide = vi.fn(
      async (_te: ToolExecution): Promise<HitlDecision> => ({ approve: true }),
    );
    let calls = 0;
    const continueRun = vi.fn(
      async (_runId: string, _opts: ContinueRunOptions) =>
        ++calls === 1 ? "part-2" : "part-3",
    );

    const result = await runHitlLoop({
      pause,
      decide,
      continueRun,
      reduceContinueStream: reduceFromFixtures({
        "part-2": "approve-repause-approve.2",
        "part-3": "approve-repause-approve.3",
      }),
    });

    // Defect A: the second confirmation round MUST fire.
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[0]![0].tool_call_id).toBe("tc-h3");
    expect(decide.mock.calls[1]![0].tool_call_id).toBe("tc-h4");
    expect(continueRun).toHaveBeenCalledTimes(2);

    const recorded2 = await loadRequestFixture("approve-repause-approve.2");
    const recorded3 = await loadRequestFixture("approve-repause-approve.3");
    const [runId1, opts1] = continueRun.mock.calls[0]!;
    const [runId2, opts2] = continueRun.mock.calls[1]!;
    expect(runId1).toBe("run-R4");
    expect(runId2).toBe("run-R4");
    expect(opts1.tools).toBe(recorded2.tools);
    expect(opts1.sessionId).toBe(recorded2.session_id);
    expect(opts2.tools).toBe(recorded3.tools);
    expect(opts2.sessionId).toBe(recorded3.session_id);
    // run_id/session_id invariant across re-pauses.
    expect(opts1.sessionId).toBe(opts2.sessionId);
    expect(result.rounds).toBe(2);
  });

  it("STILL sends continue when every tool is rejected, with the note (defect B)", async () => {
    const pause = await pauseFromFixture("reject-with-note.1", "agent-one");

    const decide = vi.fn(
      async (_te: ToolExecution): Promise<HitlDecision> => ({
        approve: false,
        note: "do not run this on PROD",
      }),
    );
    const continueRun = vi.fn(
      async (_runId: string, _opts: ContinueRunOptions) => "part-2",
    );

    const result = await runHitlLoop({
      pause,
      decide,
      continueRun,
      reduceContinueStream: reduceFromFixtures({
        "part-2": "reject-with-note.2",
      }),
    });

    // Defect B: all-rejected must NOT strand the run — continue is sent.
    expect(continueRun).toHaveBeenCalledTimes(1);
    const recorded = await loadRequestFixture("reject-with-note.2");
    const [runId, opts] = continueRun.mock.calls[0]!;
    expect(runId).toBe("run-R5");
    expect(opts.sessionId).toBe(recorded.session_id);
    expect(opts.tools).toBe(recorded.tools);
    expect(opts.tools).toContain("do not run this on PROD");
    const tools = JSON.parse(opts.tools) as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({
      tool_call_id: "tc-h5",
      confirmed: false,
      confirmation_note: "do not run this on PROD",
    });
    expect(result.rounds).toBe(1);
  });

  it("keeps run_id and session_id invariant even if a re-pause omits them", async () => {
    const first = capturePause(
      pausedEvent({
        run_id: "run-X",
        session_id: "sess-X",
        requirements: [
          {
            id: "req-1",
            created_at: "2026-06-10T12:00:00Z",
            tool_execution: toolExecution({ tool_call_id: "tc-1" }),
          },
        ],
      }),
      { entityId: "agent-one" },
    );
    const repause = capturePause(
      pausedEvent({
        run_id: "run-X",
        session_id: "", // degenerate wire data: must not clobber the captured id
        requirements: [
          {
            id: "req-2",
            created_at: "2026-06-10T12:00:01Z",
            tool_execution: toolExecution({ tool_call_id: "tc-2" }),
          },
        ],
      }),
      { entityId: "agent-one" },
    );

    const continueRun = vi.fn(
      async (_runId: string, _opts: ContinueRunOptions) => "stream",
    );
    let reduceCalls = 0;
    const result = await runHitlLoop({
      pause: first,
      decide: async () => ({ approve: true }),
      continueRun,
      reduceContinueStream: async () => (++reduceCalls === 1 ? repause : null),
    });

    expect(continueRun).toHaveBeenCalledTimes(2);
    for (const call of continueRun.mock.calls) {
      expect(call[0]).toBe("run-X");
      expect(call[1].sessionId).toBe("sess-X");
    }
    expect(result.rounds).toBe(2);
  });

  it("omits session_id entirely when none was captured (never sends '')", async () => {
    const pause = capturePause(
      pausedEvent({
        run_id: "run-X",
        requirements: [
          {
            id: "req-1",
            created_at: "2026-06-10T12:00:00Z",
            tool_execution: toolExecution({ tool_call_id: "tc-1" }),
          },
        ],
      }),
      { entityId: "agent-one", sessionId: "" },
    );
    expect(pause.sessionId).toBeNull();

    const continueRun = vi.fn(
      async (_runId: string, _opts: ContinueRunOptions) => "stream",
    );
    await runHitlLoop({
      pause,
      decide: async () => ({ approve: true }),
      continueRun,
      reduceContinueStream: async () => null,
    });

    const [, opts] = continueRun.mock.calls[0]!;
    expect(opts.sessionId).toBeUndefined();
    expect("sessionId" in opts).toBe(false);
  });

  it("auto-approves every tool without prompting (--bypass-confirmations)", async () => {
    const pause = await pauseFromFixture("multi-tool-pause", "agent-one");

    const decide = vi.fn(
      async (_te: ToolExecution): Promise<HitlDecision> => ({ approve: false }),
    );
    const continueRun = vi.fn(
      async (_runId: string, _opts: ContinueRunOptions) => "stream",
    );

    const result = await runHitlLoop({
      pause,
      autoApprove: true,
      decide, // present but must be ignored in bypass mode
      continueRun,
      reduceContinueStream: async () => null,
    });

    expect(decide).not.toHaveBeenCalled();
    expect(continueRun).toHaveBeenCalledTimes(1);
    const [runId, opts] = continueRun.mock.calls[0]!;
    expect(runId).toBe("run-R3");
    expect(opts.sessionId).toBe("sess-S3");
    const tools = JSON.parse(opts.tools) as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    for (const tool of tools) expect(tool.confirmed).toBe(true);
    expect(result.autoApproved).toBe(2);
    expect(result.rounds).toBe(1);
  });

  it("throws when neither decide nor autoApprove is provided", async () => {
    const pause = await pauseFromFixture("multi-tool-pause", "agent-one");
    await expect(
      runHitlLoop({
        pause,
        continueRun: async () => "stream",
        reduceContinueStream: async () => null,
      }),
    ).rejects.toThrow(/decide/);
  });
});

describe("buildDecisionPayload", () => {
  it("leaves non-gated entries untouched in a mixed payload", () => {
    const gated = toolExecution({ tool_call_id: "tc-gated" });
    const ungated = toolExecution({
      tool_call_id: "tc-ungated",
      requires_confirmation: false,
    });
    const payload = JSON.parse(
      buildDecisionPayload(
        [gated, ungated],
        new Map([["tc-gated", { approve: false, note: "no" }]]),
      ),
    ) as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({
      tool_call_id: "tc-gated",
      confirmed: false,
      confirmation_note: "no",
    });
    expect(payload[1]).toMatchObject({
      tool_call_id: "tc-ungated",
      confirmed: null,
      confirmation_note: null,
    });
  });

  it("defaults the rejection note when none was given", () => {
    const payload = JSON.parse(
      buildDecisionPayload(
        [toolExecution({ tool_call_id: "tc-1" })],
        new Map([["tc-1", { approve: false }]]),
      ),
    ) as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({
      confirmed: false,
      confirmation_note: "Rejected via CLI",
    });
  });
});
