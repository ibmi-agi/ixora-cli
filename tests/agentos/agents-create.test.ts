import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Asserts the `agents create/apply/update/delete` subcommands:
//   * spec resolution from -f file, with flag overrides winning over file fields
//   * --ibmi-tools file contents land in the ibmiTools array of the POST body
//   * mode=create + POST /agents:apply via client.request
//   * 409 on create maps to an actionable "already exists" error (exit 1)
//   * --dry-run short-circuits before any request
//   * no input (TTY stdin, no -f, no flags) errors at the CLI layer
//   * delete pre-checks existence via client.agents.get; NotFound skips DELETE

const requestFn = vi.fn();
const agentsGetFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
    agents = { get: agentsGetFn };
  }
  class StubError extends Error {}
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
const { APIError } = await import("@worksofadam/agentos-sdk");

const BASE = ["--url", "http://test"];
const APPLY_RESULT = {
  component_id: "demo-agent",
  stage: "published",
  version: 1,
  action: "created",
  config_keys: ["name", "model"],
  stripped_overrides: [],
  tools_written: 0,
};

let tmpDir: string;

function tmpFile(name: string, contents: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, contents);
  return p;
}

/**
 * Extract the request body and assert it is a RAW OBJECT, not a pre-stringified
 * string. The SDK's request() JSON.stringifies the body itself, so passing a
 * string double-encodes it and the server rejects with 422. This guard fails
 * loudly if a caller regresses to `body: JSON.stringify(spec)`.
 */
function bodyOf(options: unknown): Record<string, unknown> {
  const body = (options as { body: unknown }).body;
  expect(typeof body).toBe("object");
  return body as Record<string, unknown>;
}

describe("agents create/apply/update/delete", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    process.exitCode = 0;
    requestFn.mockReset();
    requestFn.mockResolvedValue(APPLY_RESULT);
    agentsGetFn.mockReset();
    agentsGetFn.mockResolvedValue({ id: "demo-agent" });
    tmpDir = mkdtempSync(join(tmpdir(), "ixora-agents-"));
    // Force TTY stdin so the "flags-only / no input" paths are deterministic
    // and stdin is never read during tests.
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
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
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create from -f file POSTs to /agents:apply with mode=create", async () => {
    const file = tmpFile(
      "agent.yaml",
      [
        "name: Demo Agent",
        "model: anthropic:claude-sonnet-4-6",
        "instructions: Be helpful.",
      ].join("\n"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "-f",
      file,
      ...BASE,
    ]);

    expect(requestFn).toHaveBeenCalledTimes(1);
    const [method, path, options] = requestFn.mock.calls[0] ?? [];
    expect(method).toBe("POST");
    expect(path).toBe("/agents:apply");
    const body = bodyOf(options);
    expect(body.mode).toBe("create");
    expect(body.name).toBe("Demo Agent");
    expect(body.model).toBe("anthropic:claude-sonnet-4-6");
    expect(body.instructions).toBe("Be helpful.");
    expect(
      (options as { headers: Record<string, string> }).headers["Content-Type"],
    ).toBe("application/json");
  });

  it("flag overrides win over file fields", async () => {
    const file = tmpFile(
      "agent.yaml",
      ["name: From File", "model: anthropic:claude-haiku-4-5"].join("\n"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "-f",
      file,
      "--name",
      "From Flag",
      "--model",
      "anthropic:claude-sonnet-4-6",
      ...BASE,
    ]);

    const [, , options] = requestFn.mock.calls[0] ?? [];
    const body = bodyOf(options);
    expect(body.name).toBe("From Flag");
    expect(body.model).toBe("anthropic:claude-sonnet-4-6");
  });

  it("flags-only create with non-TTY stdin does NOT block on stdin", async () => {
    // Regression: in a non-TTY context (CI/scripts) a flags-only invocation
    // must not fall into readStdin() and hang on empty inherited stdin. The
    // test would time out if resolveSpec tried to read stdin here.
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "--name",
      "No Stdin",
      "--model",
      "anthropic:claude-sonnet-4-6",
      ...BASE,
    ]);

    expect(requestFn).toHaveBeenCalledTimes(1);
    const body = bodyOf(requestFn.mock.calls[0]?.[2]);
    expect(body.name).toBe("No Stdin");
  });

  it("--ibmi-tools file contents land in ibmiTools of the body", async () => {
    const toolFile = tmpFile(
      "tools.yaml",
      [
        "tools:",
        "  active_jobs:",
        "    source: db2",
        "    statement: SELECT * FROM TABLE(QSYS2.ACTIVE_JOB_INFO())",
      ].join("\n"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "--name",
      "Tooled Agent",
      "--ibmi-tools",
      toolFile,
      ...BASE,
    ]);

    const [, , options] = requestFn.mock.calls[0] ?? [];
    const body = bodyOf(options);
    const ibmiTools = body.ibmiTools as Record<string, unknown>[];
    expect(Array.isArray(ibmiTools)).toBe(true);
    expect(ibmiTools).toHaveLength(1);
    const tools = (ibmiTools[0] as { tools: Record<string, unknown> }).tools;
    expect(tools).toHaveProperty("active_jobs");
  });

  it("create maps a 409 to an actionable already-exists error", async () => {
    requestFn.mockRejectedValueOnce(new APIError(409, "exists"));

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "agents",
        "create",
        "--name",
        "Dup Agent",
        ...BASE,
      ]),
    ).resolves.toBeDefined();

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/already exists/i);
    expect(stderr).toMatch(/apply/);
    expect(stderr).toMatch(/update/);
    expect(process.exitCode).toBe(1);
  });

  it("--dry-run does not POST and emits dry_run JSON", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "--name",
      "Dry Agent",
      "--dry-run",
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toMatch(/"dry_run": true/);
    expect(stdout).toMatch(/agents\.create/);
  });

  it("errors when no -f, TTY stdin, and no flags are given", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "ixora", "agents", "create", ...BASE]),
    ).resolves.toBeDefined();

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Provide a manifest/);
    expect(process.exitCode).toBe(1);
  });

  it("delete skips DELETE when agents.get reports NotFound", async () => {
    agentsGetFn.mockRejectedValueOnce(new APIError(404, "not found"));

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "ixora",
        "agents",
        "delete",
        "ghost-agent",
        ...BASE,
      ]),
    ).resolves.toBeDefined();

    expect(agentsGetFn).toHaveBeenCalledTimes(1);
    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/ghost-agent/);
    expect(stderr).toMatch(/not found/i);
    expect(process.exitCode).toBe(1);
  });
});
