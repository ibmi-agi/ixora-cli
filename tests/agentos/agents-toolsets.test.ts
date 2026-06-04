import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Covers `agents toolsets list` / `get <name>`:
//   * list → raw JSON catalog, GET /toolsets
//   * get  → raw JSON entry, GET /toolsets/<name>
//   * output is ALWAYS raw JSON (a table/format flag is ignored)
//   * unknown toolset → capitalized Error on stderr, exit 1

const CATALOG = [
  {
    name: "daily_health",
    title: "Daily Health",
    description: "Routine checks.",
    tool_count: 7,
  },
  { name: "performance", title: "", description: "", tool_count: 11 },
];

const PERFORMANCE_ENTRY = {
  tools: ["system_status", "active_job_info"],
  source: "performance.yaml",
  tool_metadata: {
    system_status: { description: "First-call health check.", parameters: [] },
    active_job_info: {
      description: "Active jobs.",
      parameters: [{ name: "job_filter", type: "string" }],
    },
  },
};

const requestFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
  }
  // Distinct classes so `handleError`'s instanceof branches disambiguate
  // (it checks AuthenticationError before NotFoundError).
  class APIError extends Error {}
  class AuthenticationError extends Error {}
  class BadRequestError extends Error {}
  class InternalServerError extends Error {}
  class NotFoundError extends Error {}
  class RateLimitError extends Error {}
  class RemoteServerUnavailableError extends Error {}
  class UnprocessableEntityError extends Error {}
  return {
    AgentOSClient,
    APIError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    RateLimitError,
    RemoteServerUnavailableError,
    UnprocessableEntityError,
  };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);
const { NotFoundError } = await import("@worksofadam/agentos-sdk");

const BASE = ["--url", "http://test"];

describe("agents toolsets", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    requestFn.mockReset();
    process.exitCode = 0;
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list prints the raw JSON catalog and calls GET /toolsets", async () => {
    requestFn.mockResolvedValue(CATALOG);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "toolsets",
      "list",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(stdout)).toEqual(CATALOG);
    expect(requestFn).toHaveBeenCalledWith("GET", "/toolsets");
  });

  it("get prints the raw toolset entry and calls GET /toolsets/<name>", async () => {
    requestFn.mockResolvedValue(PERFORMANCE_ENTRY);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "toolsets",
      "get",
      "performance",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(stdout)).toEqual(PERFORMANCE_ENTRY);
    expect(requestFn).toHaveBeenCalledWith("GET", "/toolsets/performance");
  });

  it("always emits raw JSON, ignoring --output table", async () => {
    requestFn.mockResolvedValue(CATALOG);
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "toolsets",
      "list",
      "--output",
      "table",
      ...BASE,
    ]);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    // The table format flag is ignored — output is the full raw JSON array.
    expect(JSON.parse(stdout)).toEqual(CATALOG);
  });

  it("get on an unknown toolset → Error on stderr, exit 1", async () => {
    requestFn.mockRejectedValue(new NotFoundError("not found"));
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "agents",
        "toolsets",
        "get",
        "badname",
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Toolset 'badname' not found/);
    expect(stderr).toMatch(/ixora agents toolsets list/);
    expect(process.exitCode).toBe(1);
  });
});
