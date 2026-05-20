import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifies pollBackgroundRun (GET path + query params) and the pure
// exitCodeForStatus / isFinishedStatus status helpers.

vi.mock("@worksofadam/agentos-sdk", () => ({ AgentOSClient: class {} }));

const { pollBackgroundRun, exitCodeForStatus, isFinishedStatus } = await import(
  "../../src/lib/agentos-background.js"
);

describe("pollBackgroundRun", () => {
  const requestSpy = vi.fn();
  const client = {
    request: requestSpy,
  } as unknown as Parameters<typeof pollBackgroundRun>[0];

  beforeEach(() => {
    requestSpy.mockReset();
    requestSpy.mockResolvedValue({ status: "RUNNING" });
  });

  it("GETs the run endpoint for each resource type", async () => {
    await pollBackgroundRun(client, "agent", "ag-1", "run-1");
    expect(requestSpy.mock.calls[0]).toEqual([
      "GET",
      "/agents/ag-1/runs/run-1",
    ]);
    requestSpy.mockClear();
    await pollBackgroundRun(client, "team", "t1", "run-1");
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/teams/t1/runs/run-1");
    requestSpy.mockClear();
    await pollBackgroundRun(client, "workflow", "w1", "run-1");
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/workflows/w1/runs/run-1");
  });

  it("appends session_id as a query param when provided", async () => {
    await pollBackgroundRun(client, "agent", "ag-1", "run-1", "sess-1");
    expect(requestSpy.mock.calls[0]?.[1]).toBe(
      "/agents/ag-1/runs/run-1?session_id=sess-1",
    );
  });

  it("omits the query param when session_id is null", async () => {
    await pollBackgroundRun(client, "agent", "ag-1", "run-1", null);
    expect(requestSpy.mock.calls[0]?.[1]).toBe("/agents/ag-1/runs/run-1");
  });

  it("URI-encodes path and query", async () => {
    await pollBackgroundRun(client, "agent", "ag 1", "run/1", "s 1");
    expect(requestSpy.mock.calls[0]?.[1]).toBe(
      "/agents/ag%201/runs/run%2F1?session_id=s%201",
    );
  });
});

describe("exitCodeForStatus", () => {
  it.each([
    ["COMPLETED", 0],
    ["RUNNING", 0],
    ["PENDING", 0],
    ["PAUSED", 4],
    ["ERROR", 2],
    ["FAILED", 2],
    ["CANCELLED", 1],
    ["something-else", 1],
  ])("maps %s -> exit %i", (status, code) => {
    expect(exitCodeForStatus(status)).toBe(code);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(exitCodeForStatus("completed")).toBe(0);
    expect(exitCodeForStatus("  paused ")).toBe(4);
  });
});

describe("isFinishedStatus", () => {
  it("is true only for terminal statuses", () => {
    for (const s of ["COMPLETED", "ERROR", "FAILED", "CANCELLED"]) {
      expect(isFinishedStatus(s)).toBe(true);
    }
    for (const s of ["RUNNING", "PENDING", "PAUSED"]) {
      expect(isFinishedStatus(s)).toBe(false);
    }
  });
});
