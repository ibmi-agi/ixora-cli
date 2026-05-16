import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Covers:
//   * operationId lookup
//   * path lookup with a single method
//   * ambiguous path requires --method
//   * --method disambiguates
//   * curl example contains baseUrl + $AGENTOS_KEY placeholder
//   * $ref resolution inlines components.schemas
//   * unknown key → "No operation found"

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
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EvalRunInput" },
            },
          },
        },
      },
      delete: {
        operationId: "delete_eval_runs",
        summary: "Delete eval runs",
        tags: ["Evals"],
      },
    },
  },
  components: {
    schemas: {
      EvalRunInput: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          eval_type: { type: "string" },
          input: { type: "string" },
        },
      },
    },
  },
};

const requestFn = vi.fn().mockResolvedValue(FIXTURE_SPEC);

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
  }
  class StubError extends Error {}
  return {
    AgentOSClient,
    APIError: StubError,
    AuthenticationError: StubError,
    BadRequestError: StubError,
    InternalServerError: StubError,
    NotFoundError: StubError,
    RateLimitError: StubError,
    RemoteServerUnavailableError: StubError,
    UnprocessableEntityError: StubError,
  };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

const BASE = ["--url", "http://test"];

describe("docs show", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    requestFn.mockClear();
    requestFn.mockResolvedValue(FIXTURE_SPEC);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("__exit__");
      }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("looks up by operationId", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "show",
      "list_agents",
      "--json",
      "method,operation_id",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ method: "get", operation_id: "list_agents" });
  });

  it("looks up by path with a single method", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "show",
      "/agents",
      "--json",
      "method,path",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(stdout)).toEqual({ method: "get", path: "/agents" });
  });

  it("errors on ambiguous path without --method (lists available methods)", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "docs",
        "show",
        "/eval-runs",
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/multiple methods/);
    expect(stderr).toMatch(/GET/);
    expect(stderr).toMatch(/POST/);
    expect(stderr).toMatch(/DELETE/);
  });

  it("--method disambiguates", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "show",
      "/eval-runs",
      "--method",
      "POST",
      "--json",
      "method,operation_id",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(stdout)).toEqual({
      method: "post",
      operation_id: "create_eval_run",
    });
  });

  it("curl example includes base URL and $AGENTOS_KEY placeholder", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "show",
      "/eval-runs",
      "--method",
      "POST",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toContain("curl -X POST");
    expect(stdout).toContain("http://test/eval-runs");
    expect(stdout).toContain("Authorization: Bearer $AGENTOS_KEY");
    expect(stdout).toContain("Content-Type: application/json");
  });

  it("inlines $ref from components.schemas", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "show",
      "create_eval_run",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    // The curl JSON body stub should contain field names from EvalRunInput,
    // i.e. the $ref to components.schemas.EvalRunInput got inlined.
    expect(stdout).toContain("agent_id");
    expect(stdout).toContain("eval_type");
    expect(stdout).toContain("input");
    // The request_body field should report the resolved JSON schema.
    expect(stdout).toMatch(/request_body/);
    expect(stdout).toMatch(/application\/json/);
  });

  it("errors when neither operationId nor path match", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "docs",
        "show",
        "nonexistent",
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/No operation found/);
  });
});
