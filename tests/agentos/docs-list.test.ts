import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE_SPEC = {
  openapi: "3.1.0",
  paths: {
    "/agents": {
      get: {
        operationId: "list_agents",
        summary: "List agents",
        tags: ["Agents"],
      },
    },
    "/eval-runs": {
      get: {
        operationId: "list_eval_runs",
        summary: "List eval runs",
        tags: ["Evals"],
      },
      post: {
        operationId: "create_eval_run",
        summary: "Run an eval",
        tags: ["Evals"],
      },
    },
  },
};

const requestFn = vi.fn().mockResolvedValue(FIXTURE_SPEC);

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
  }
  return { AgentOSClient };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

const BASE = ["--url", "http://test"];

describe("docs list", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    requestFn.mockClear();
    requestFn.mockResolvedValue(FIXTURE_SPEC);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  it("--json id,method,path emits flattened rows for every (path, method) pair", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "list",
      "--json",
      "method,path,operation_id",
      ...BASE,
    ]);

    expect(requestFn).toHaveBeenCalledWith("GET", "/openapi.json");
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual([
      { method: "GET", path: "/agents", operation_id: "list_agents" },
      { method: "GET", path: "/eval-runs", operation_id: "list_eval_runs" },
      { method: "POST", path: "/eval-runs", operation_id: "create_eval_run" },
    ]);
  });

  it("--tag filters case-insensitively", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "list",
      "--tag",
      "evals",
      "--json",
      "operation_id",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual([
      { operation_id: "list_eval_runs" },
      { operation_id: "create_eval_run" },
    ]);
  });
});
