import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies that the resume helper:
//   1. POSTs to /{plural}/{id}/runs/{run_id}/resume
//   2. Encodes last_event_index + session_id as form fields
//   3. Wraps the SSE Response in an AgentStream

const requestStreamSpy = vi.fn();
const fromSSEResponseSpy = vi.fn().mockReturnValue({ aborted: false });

vi.mock("@worksofadam/agentos-sdk", () => {
  return {
    AgentOSClient: class {},
    AgentStream: {
      fromSSEResponse: (...args: unknown[]) => fromSSEResponseSpy(...args),
    },
  };
});

const { requestResumeStream } = await import(
  "../../src/lib/agentos-resume.js"
);

function makeClient() {
  return {
    requestStream: requestStreamSpy,
  } as unknown as Parameters<typeof requestResumeStream>[0];
}

function readForm(body: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  body.forEach((v, k) => {
    out[k] = String(v);
  });
  return out;
}

describe("requestResumeStream", () => {
  beforeEach(() => {
    requestStreamSpy.mockReset();
    fromSSEResponseSpy.mockClear();
    requestStreamSpy.mockResolvedValue(new Response(""));
  });

  it("targets the agent resume endpoint", async () => {
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1");
    const [method, path] = requestStreamSpy.mock.calls[0] ?? [];
    expect(method).toBe("POST");
    expect(path).toBe("/agents/ag-1/runs/run-1/resume");
  });

  it("targets the team resume endpoint", async () => {
    await requestResumeStream(makeClient(), "team", "team-1", "run-1");
    expect(requestStreamSpy.mock.calls[0]?.[1]).toBe(
      "/teams/team-1/runs/run-1/resume",
    );
  });

  it("targets the workflow resume endpoint", async () => {
    await requestResumeStream(makeClient(), "workflow", "wf-1", "run-1");
    expect(requestStreamSpy.mock.calls[0]?.[1]).toBe(
      "/workflows/wf-1/runs/run-1/resume",
    );
  });

  it("URI-encodes path params", async () => {
    await requestResumeStream(makeClient(), "agent", "ag/1", "run 1");
    expect(requestStreamSpy.mock.calls[0]?.[1]).toBe(
      "/agents/ag%2F1/runs/run%201/resume",
    );
  });

  it("includes last_event_index when provided", async () => {
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1", {
      lastEventIndex: 42,
    });
    const body = requestStreamSpy.mock.calls[0]?.[2]?.body as FormData;
    expect(readForm(body)).toEqual({ last_event_index: "42" });
  });

  it("includes session_id when provided", async () => {
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1", {
      sessionId: "sess-1",
    });
    const body = requestStreamSpy.mock.calls[0]?.[2]?.body as FormData;
    expect(readForm(body)).toEqual({ session_id: "sess-1" });
  });

  it("sends an empty form body when no options are provided", async () => {
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1");
    const body = requestStreamSpy.mock.calls[0]?.[2]?.body as FormData;
    expect(readForm(body)).toEqual({});
  });

  it("encodes last_event_index = 0 (the legitimate start-of-stream sentinel)", async () => {
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1", {
      lastEventIndex: 0,
    });
    const body = requestStreamSpy.mock.calls[0]?.[2]?.body as FormData;
    expect(readForm(body)).toEqual({ last_event_index: "0" });
  });

  it("passes an AbortController signal so the stream is cancellable", async () => {
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1");
    const opts = requestStreamSpy.mock.calls[0]?.[2];
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it("wraps the Response in an AgentStream", async () => {
    const fakeResp = new Response("");
    requestStreamSpy.mockResolvedValue(fakeResp);
    await requestResumeStream(makeClient(), "agent", "ag-1", "run-1");
    expect(fromSSEResponseSpy).toHaveBeenCalledOnce();
    expect(fromSSEResponseSpy.mock.calls[0]?.[0]).toBe(fakeResp);
  });
});
