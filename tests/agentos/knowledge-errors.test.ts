import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression tests for two knowledge command error-reporting bugs:
//   * `knowledge get` on a missing content_id reported "Knowledge base not
//     found" (wrong resource, no id, no discovery hint). It must report the
//     content_id and a scoped `knowledge list` command instead.
//   * `knowledge status` returns HTTP 200 with status:"failed" /
//     status_message:"Content not found" for a missing content, and the CLI
//     exited 0. A terminal failure must exit non-zero.

const getFn = vi.fn();
const getStatusFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    knowledge = { get: getFn, getStatus: getStatusFn };
  }
  class StubError extends Error {}
  // NotFoundError must be its own class: handleError checks `instanceof`
  // branch-by-branch, so aliasing every error to one StubError makes a
  // thrown NotFoundError match the earlier AuthenticationError branch.
  class NotFoundError extends Error {}
  class APIError extends Error {
    status: number;
    constructor(status: number, message = "") {
      super(message);
      this.status = status;
    }
  }
  return {
    AgentOSClient,
    APIError,
    AuthenticationError: StubError,
    BadRequestError: StubError,
    InternalServerError: StubError,
    NotFoundError,
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
const { NotFoundError } = await import("@worksofadam/agentos-sdk");

const BASE = ["--url", "http://test"];
const KB = "90d16932-cf61-2b9b-cc41-447661071e4c";
const BAD = "0e77ed3ca41f7b8331cf33137ae42bfa";

describe("knowledge get/status error reporting", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    process.exitCode = 0;
    getFn.mockReset();
    getStatusFn.mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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

  const stderr = () =>
    stderrSpy.mock.calls.map((c) => String(c[0])).join("");

  it("get: a missing content reports the content_id and a scoped list hint, not 'Knowledge base not found'", async () => {
    getFn.mockRejectedValueOnce(new NotFoundError("Content not found"));

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "knowledge",
        "get",
        BAD,
        "--knowledge-id",
        KB,
        ...BASE,
      ]),
    ).rejects.toThrow("__exit__");

    expect(stderr()).toMatch(new RegExp(`Knowledge content '${BAD}' not found`));
    expect(stderr()).toMatch(/ixora knowledge list --knowledge-id 90d16932/);
    expect(stderr()).not.toMatch(/Knowledge base not found/);
    expect(process.exitCode).toBe(1);
  });

  it("get: a successful fetch exits zero", async () => {
    getFn.mockResolvedValueOnce({
      id: "good",
      name: "Doc",
      status: "completed",
      type: "Text",
      content: "hi",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "get",
      "good",
      "--knowledge-id",
      KB,
      "-o",
      "json",
      ...BASE,
    ]);

    expect(process.exitCode).toBe(0);
  });

  it("status: a 200 'failed / Content not found' body exits non-zero with an actionable error", async () => {
    getStatusFn.mockResolvedValueOnce({
      id: BAD,
      status: "failed",
      status_message: "Content not found",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "status",
      BAD,
      "--knowledge-id",
      KB,
      "-o",
      "json",
      ...BASE,
    ]);

    expect(stderr()).toMatch(new RegExp(`Knowledge content '${BAD}' not found`));
    expect(process.exitCode).toBe(1);
  });

  it("status: a generic terminal failure (not a not-found) still exits non-zero", async () => {
    getStatusFn.mockResolvedValueOnce({
      id: "x",
      status: "failed",
      status_message: "Reader error: unsupported type",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "status",
      "x",
      "--knowledge-id",
      KB,
      "-o",
      "json",
      ...BASE,
    ]);

    expect(stderr()).toMatch(/Content processing failed: Reader error/);
    expect(process.exitCode).toBe(1);
  });

  it("status: a completed status exits zero", async () => {
    getStatusFn.mockResolvedValueOnce({
      id: "good",
      status: "completed",
      status_message: "",
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "status",
      "good",
      "--knowledge-id",
      KB,
      "-o",
      "json",
      ...BASE,
    ]);

    expect(process.exitCode).toBe(0);
  });
});
