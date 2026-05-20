import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the background-run start helpers:
//   1. buildBackgroundForm sets message/stream=false/background=true
//   2. startBackgroundRun POSTs /{plural}/{id}/runs and returns the 202 body

vi.mock("@worksofadam/agentos-sdk", () => ({ AgentOSClient: class {} }));

const { buildBackgroundForm, startBackgroundRun } = await import(
  "../../src/lib/agentos-background.js"
);

function readForm(body: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  body.forEach((v, k) => {
    out[k] = String(v);
  });
  return out;
}

describe("buildBackgroundForm", () => {
  it("always sets message, stream=false, background=true", () => {
    expect(readForm(buildBackgroundForm({ message: "hi" }))).toEqual({
      message: "hi",
      stream: "false",
      background: "true",
    });
  });

  it("includes session_id and user_id when provided", () => {
    expect(
      readForm(
        buildBackgroundForm({ message: "hi", sessionId: "s1", userId: "u1" }),
      ),
    ).toEqual({
      message: "hi",
      stream: "false",
      background: "true",
      session_id: "s1",
      user_id: "u1",
    });
  });
});

describe("startBackgroundRun", () => {
  const requestSpy = vi.fn();
  const client = {
    request: requestSpy,
  } as unknown as Parameters<typeof startBackgroundRun>[0];

  beforeEach(() => {
    requestSpy.mockReset();
  });

  it("POSTs to /agents/{id}/runs and returns the 202 body", async () => {
    requestSpy.mockResolvedValue({
      run_id: "r1",
      session_id: "s1",
      status: "PENDING",
    });
    const res = await startBackgroundRun(client, "agent", "ag-1", {
      message: "hi",
    });
    expect(requestSpy.mock.calls[0]?.[0]).toBe("POST");
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/agents/ag-1/runs");
    expect(res).toEqual({ run_id: "r1", session_id: "s1", status: "PENDING" });
  });

  it("targets the team and workflow run endpoints", async () => {
    requestSpy.mockResolvedValue({ run_id: "r1" });
    await startBackgroundRun(client, "team", "t1", { message: "hi" });
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/teams/t1/runs");
    requestSpy.mockClear();
    await startBackgroundRun(client, "workflow", "w1", { message: "hi" });
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/workflows/w1/runs");
  });

  it("URI-encodes the resource id", async () => {
    requestSpy.mockResolvedValue({ run_id: "r1" });
    await startBackgroundRun(client, "agent", "ag/1", { message: "hi" });
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/agents/ag%2F1/runs");
  });

  it("sends the background form as the request body", async () => {
    requestSpy.mockResolvedValue({ run_id: "r1" });
    await startBackgroundRun(client, "agent", "ag-1", {
      message: "hi",
      sessionId: "s1",
    });
    const body = requestSpy.mock.calls[0]?.[2]?.body as FormData;
    expect(readForm(body)).toEqual({
      message: "hi",
      stream: "false",
      background: "true",
      session_id: "s1",
    });
  });

  it("defaults session_id to null and status to PENDING when omitted", async () => {
    requestSpy.mockResolvedValue({ run_id: "r1" });
    const res = await startBackgroundRun(client, "agent", "ag-1", {
      message: "hi",
    });
    expect(res.session_id).toBeNull();
    expect(res.status).toBe("PENDING");
  });

  it("throws when the server returns no run_id", async () => {
    requestSpy.mockResolvedValue({ status: "PENDING" });
    await expect(
      startBackgroundRun(client, "agent", "ag-1", { message: "hi" }),
    ).rejects.toThrow(/run_id/);
  });
});
