import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Asserts the `evals run` subcommand:
//   * mutex/required validation runs at the CLI layer (no SDK call on failure)
//   * happy path POSTs to /eval-runs via client.request with a snake_case JSON body
//     (we bypass client.evals.create() because the SDK double-stringifies)
//   * --expected-tool-calls CSV splits to an array
//   * --json projection passes through to the detail output

const requestFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
  }
  // handleError does `err instanceof <SdkError>` checks; provide stubs so the
  // module loads even when our tests never hit those branches.
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
const FIXTURE_RESULT = {
  id: "eval-1",
  name: "demo",
  eval_type: "reliability",
  agent_id: "ag-1",
  eval_data: {
    eval_status: "PASSED",
    passed_tool_calls: ["multiply"],
    failed_tool_calls: [],
  },
  created_at: "2026-01-01T00:00:00Z",
};

describe("evals run", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    requestFn.mockReset();
    requestFn.mockResolvedValue(FIXTURE_RESULT);
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

  it("rejects --agent-id and --team-id together", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "evals",
        "run",
        "--agent-id",
        "a",
        "--team-id",
        "b",
        "--eval-type",
        "accuracy",
        "--input",
        "x",
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Exactly one of --agent-id or --team-id/);
  });

  it("rejects accuracy without --expected-output", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "evals",
        "run",
        "--agent-id",
        "a",
        "--eval-type",
        "accuracy",
        "--input",
        "x",
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/--expected-output is required.*accuracy/);
  });

  it("rejects agent_as_judge without --criteria", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "evals",
        "run",
        "--agent-id",
        "a",
        "--eval-type",
        "agent_as_judge",
        "--input",
        "x",
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/--criteria is required.*agent_as_judge/);
  });

  it("splits --expected-tool-calls CSV into an array and POSTs to /eval-runs", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "evals",
      "run",
      "--agent-id",
      "ag-1",
      "--eval-type",
      "reliability",
      "--input",
      "multiply 2 and 3",
      "--expected-tool-calls",
      "multiply, add ,subtract",
      "--model-id",
      "gpt-4o",
      ...BASE,
    ]);

    expect(requestFn).toHaveBeenCalledTimes(1);
    const [method, path, options] = requestFn.mock.calls[0] ?? [];
    expect(method).toBe("POST");
    expect(path).toBe("/eval-runs");
    expect((options as { body: Record<string, unknown> }).body).toEqual({
      agent_id: "ag-1",
      model_id: "gpt-4o",
      eval_type: "reliability",
      input: "multiply 2 and 3",
      expected_tool_calls: ["multiply", "add", "subtract"],
    });
    expect(
      (options as { headers: Record<string, string> }).headers["Content-Type"],
    ).toBe("application/json");
  });

  it("renders detail output with eval_data flattened", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "evals",
      "run",
      "--agent-id",
      "ag-1",
      "--eval-type",
      "reliability",
      "--input",
      "x",
      "--expected-tool-calls",
      "multiply",
      "-o",
      "table",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toMatch(/Eval Status/);
    expect(stdout).toMatch(/PASSED/);
  });

  it("--json id,eval_type projects the detail", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "evals",
      "run",
      "--agent-id",
      "ag-1",
      "--eval-type",
      "reliability",
      "--input",
      "x",
      "--expected-tool-calls",
      "multiply",
      "--json",
      "id,eval_type",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toBe(
      `${JSON.stringify({ id: "eval-1", eval_type: "reliability" }, null, 2)}\n`,
    );
  });
});
