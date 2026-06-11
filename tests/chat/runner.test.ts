// Integration tests for the chat controller: fixtures replayed through the
// FULL runner → reducer path with a mocked SDK client and a headless shell.
// Covers: simple run, pause → approve → STREAMING continue with re-pause
// (openagent defect A at the runner level), and Esc-cancel (abort + REST
// cancel guarded by runCompleted).

import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStream, type StreamEvent } from "@worksofadam/agentos-sdk";
import type { Component, TUI } from "@earendil-works/pi-tui";

const fakeClient = {
  agents: {
    list: vi.fn(),
    get: vi.fn(),
    runStream: vi.fn(),
    continue: vi.fn(),
    cancel: vi.fn(),
  },
  teams: {
    list: vi.fn(),
    get: vi.fn(),
    runStream: vi.fn(),
    continue: vi.fn(),
    cancel: vi.fn(),
  },
  workflows: {
    list: vi.fn(),
    get: vi.fn(),
    runStream: vi.fn(),
    continue: vi.fn(),
    cancel: vi.fn(),
  },
  sessions: { list: vi.fn(), getRuns: vi.fn() },
};

vi.mock("../../src/lib/agentos-client.js", () => ({
  getClient: () => fakeClient,
  getBaseUrl: () => "http://chat-test:8000",
  isUrlOverridden: () => false,
  resetClient: vi.fn(),
  urlContext: () => ({ url: "http://chat-test:8000", viaOverrideUrl: false }),
}));

const { ChatController } = await import("../../src/lib/chat/runner.js");
const { buildChatTheme } = await import("../../src/lib/chat/theme.js");
const { setAgentOSContext } = await import("../../src/lib/agentos-context.js");
const { fixturePath } = await import("./helpers.js");
import type { ChatShell } from "../../src/lib/chat/app.js";
import type { Command } from "commander";

const theme = buildChatTheme();

/** Real SDK stream over recorded fixture bytes — the live parse path. */
async function fixtureStream(name: string): Promise<AgentStream> {
  const body = await readFile(fixturePath(`${name}.sse`), "utf8");
  const response = new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
  return AgentStream.fromSSEResponse(response, new AbortController());
}

/** Stream that emits `events` then hangs until abort() — for Esc-cancel. */
function hangingStream(events: StreamEvent[]): AgentStream {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fake = {
    aborted: false,
    abort(): void {
      fake.aborted = true;
      release();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
      for (const event of events) yield event;
      await gate;
    },
  };
  return fake as unknown as AgentStream;
}

class FakeShell implements ChatShell {
  readonly tui = {} as TUI;
  onSubmit: (text: string) => unknown = () => {};
  onInterrupt: () => void = () => {};
  onBeforeExit: () => void | Promise<void> = () => {};
  readonly components: Component[] = [];
  header = "";
  hints: string[] = [];

  start(): void {}
  async exit(): Promise<never> {
    throw new Error("__exit__");
  }
  restoreTerminal(): void {}
  setHeader(text: string): void {
    this.header = text;
  }
  addToTranscript(component: Component): void {
    this.components.push(component);
  }
  setBusy(): void {}
  setHint(text: string): void {
    this.hints.push(text);
  }
  requestRender(): void {}

  rendered(width = 120): string {
    return this.components
      .flatMap((c) => c.render(width))
      .join("\n");
  }
}

const cmd = { optsWithGlobals: () => ({}) } as unknown as Command;

function makeController(shell: FakeShell) {
  setAgentOSContext({ baseUrl: "http://chat-test:8000", timeout: 30 });
  return new ChatController(shell, theme, cmd);
}

beforeEach(() => {
  fakeClient.agents.list.mockResolvedValue([
    { id: "demo-agent", name: "Demo Agent", description: "test agent" },
  ]);
  fakeClient.teams.list.mockResolvedValue([]);
  fakeClient.workflows.list.mockResolvedValue([]);
});

describe("ChatController", () => {
  it("streams a simple run into the transcript with metrics", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    fakeClient.agents.runStream.mockResolvedValue(
      await fixtureStream("simple-run"),
    );

    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    await shell.onSubmit("hello there");

    expect(fakeClient.agents.runStream).toHaveBeenCalledWith("demo-agent", {
      message: "hello there",
    });
    const rendered = shell.rendered();
    expect(rendered).toContain("you ❯ hello there");
    expect(rendered).toContain("tokens:");
    // Session captured from RunStarted threads the next run.
    fakeClient.agents.runStream.mockResolvedValue(
      await fixtureStream("simple-run"),
    );
    await shell.onSubmit("again");
    expect(fakeClient.agents.runStream).toHaveBeenLastCalledWith("demo-agent", {
      message: "again",
      sessionId: "sess-S1",
    });
  });

  it("drives approve→re-pause→approve through STREAMING continues (defect A)", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    fakeClient.agents.runStream.mockResolvedValue(
      await fixtureStream("approve-repause-approve.1"),
    );
    fakeClient.agents.continue
      .mockResolvedValueOnce(await fixtureStream("approve-repause-approve.2"))
      .mockResolvedValueOnce(await fixtureStream("approve-repause-approve.3"));

    await controller.start({
      entity: { kind: "agent", id: "demo-agent" },
      bypassConfirmations: true,
    });
    await shell.onSubmit("run the gated tools");

    // Two pause rounds → two continues, run_id/session_id invariant.
    expect(fakeClient.agents.continue).toHaveBeenCalledTimes(2);
    for (const call of fakeClient.agents.continue.mock.calls) {
      expect(call[0]).toBe("demo-agent");
      expect(call[1]).toBe("run-R4");
      expect(call[2].sessionId).toBe("sess-S4");
      expect(call[2].stream).toBe(true);
      const tools = JSON.parse(call[2].tools as string) as Array<
        Record<string, unknown>
      >;
      expect(tools.every((t) => t.confirmed === true)).toBe(true);
    }
    const rendered = shell.rendered();
    expect(rendered).toContain("auto-approved");
    expect(rendered).toContain("tokens:");
  });

  it("Esc aborts the stream, REST-cancels the run, and renders the banner", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    const stream = hangingStream([
      {
        event: "RunStarted",
        created_at: 1781179200,
        run_id: "run-X1",
        session_id: "sess-X1",
        agent_id: "demo-agent",
      } as unknown as StreamEvent,
      {
        event: "RunContent",
        created_at: 1781179201,
        run_id: "run-X1",
        content: "partial ",
      } as unknown as StreamEvent,
    ]);
    fakeClient.agents.runStream.mockResolvedValue(stream);
    fakeClient.agents.cancel.mockResolvedValue(undefined);

    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    const turn = shell.onSubmit("never finishes") as Promise<void>;
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.interrupt();
    await turn;

    expect(fakeClient.agents.cancel).toHaveBeenCalledWith(
      "demo-agent",
      "run-X1",
    );
    const rendered = shell.rendered();
    expect(rendered).toContain("partial");
    expect(rendered).toContain("cancelled");
  });

  it("Esc after a terminal event mid-stream renders no false cancelled banner", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    // Stream delivers RunPaused (terminal: runCompleted=true) then stays
    // open — Esc in that window must be a no-op, not a cancel.
    const stream = hangingStream([
      {
        event: "RunStarted",
        created_at: 1781179200,
        run_id: "run-Z1",
        session_id: "sess-Z1",
        agent_id: "demo-agent",
      } as unknown as StreamEvent,
      {
        event: "RunPaused",
        created_at: 1781179201,
        run_id: "run-Z1",
        session_id: "sess-Z1",
        agent_id: "demo-agent",
        tools: [],
      } as unknown as StreamEvent,
    ]);
    fakeClient.agents.runStream.mockResolvedValue(stream);

    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    const turn = shell.onSubmit("pauses then hangs") as Promise<void>;
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.interrupt();
    expect(fakeClient.agents.cancel).not.toHaveBeenCalled();
    expect(shell.rendered()).not.toContain("cancelled");
    stream.abort(); // release the hanging stream so the turn resolves
    await turn;
  });

  it("does NOT cancel a run that already completed (runCompleted guard)", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    fakeClient.agents.runStream.mockResolvedValue(
      await fixtureStream("simple-run"),
    );
    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    await shell.onSubmit("quick run");
    controller.interrupt(); // nothing in flight — must be a no-op
    expect(fakeClient.agents.cancel).not.toHaveBeenCalled();
  });

  it("leaves a zero-gated pause paused with a resume hint instead of looping promptlessly", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    const pauseBody = [
      'data: {"event": "RunStarted", "created_at": 1781179200, "run_id": "run-U1", "session_id": "sess-U1", "agent_id": "demo-agent"}',
      "",
      'data: {"event": "RunPaused", "created_at": 1781179201, "run_id": "run-U1", "session_id": "sess-U1", "agent_id": "demo-agent", "requirements": [{"id": "req-u1", "created_at": "2026-06-11T00:00:00Z", "tool_execution": {"tool_call_id": "tc-u1", "tool_name": "ask_user", "tool_args": {}, "requires_confirmation": false, "confirmed": null, "confirmation_note": null, "requires_user_input": true}}]}',
      "",
      "",
    ].join("\n");
    fakeClient.agents.runStream.mockResolvedValue(
      AgentStream.fromSSEResponse(
        new Response(pauseBody, {
          headers: { "Content-Type": "text/event-stream" },
        }),
        new AbortController(),
      ),
    );

    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    await shell.onSubmit("needs user input");

    expect(fakeClient.agents.continue).not.toHaveBeenCalled();
    const rendered = shell.rendered();
    expect(rendered).toContain("remains paused");
    expect(rendered).toContain("run-U1");
  });

  it("onBeforeExit aborts and REST-cancels a live run", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    const stream = hangingStream([
      {
        event: "RunStarted",
        created_at: 1781179200,
        run_id: "run-Y1",
        session_id: "sess-Y1",
        agent_id: "demo-agent",
      } as unknown as StreamEvent,
    ]);
    fakeClient.agents.runStream.mockResolvedValue(stream);
    fakeClient.agents.cancel.mockResolvedValue(undefined);

    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    const turn = shell.onSubmit("about to exit") as Promise<void>;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await shell.onBeforeExit();
    await turn;

    expect(fakeClient.agents.cancel).toHaveBeenCalledWith(
      "demo-agent",
      "run-Y1",
    );
  });

  it("renders per-message errors in-transcript without killing the session", async () => {
    const shell = new FakeShell();
    const controller = makeController(shell);
    fakeClient.agents.runStream.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );
    await controller.start({ entity: { kind: "agent", id: "demo-agent" } });
    await shell.onSubmit("doomed message");
    expect(shell.rendered()).toContain("Error: connect ECONNREFUSED");

    // The session survives: the next submit still runs.
    fakeClient.agents.runStream.mockResolvedValue(
      await fixtureStream("simple-run"),
    );
    await shell.onSubmit("recovers");
    expect(shell.rendered()).toContain("tokens:");
  });
});
