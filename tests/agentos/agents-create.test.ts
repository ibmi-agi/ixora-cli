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

  it("delete issues DELETE and reports success when the agent exists", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "delete",
      "demo-agent",
      ...BASE,
    ]);

    expect(agentsGetFn).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledTimes(1);
    const [method, path] = requestFn.mock.calls[0] ?? [];
    expect(method).toBe("DELETE");
    expect(path).toBe("/agents/demo-agent");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Deleted agent 'demo-agent'/);
    expect(process.exitCode).toBe(0);
  });

  it("create rejects a model missing a side of 'provider:id'", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "--name",
      "X",
      "--model",
      "anthropic:",
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Invalid --model/);
    expect(process.exitCode).toBe(1);
  });

  it("update with no fields errors and does not POST", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "update",
      "demo-agent",
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/at least one field/i);
    expect(process.exitCode).toBe(1);
  });

  it("--ibmi-tools missing path errors before any POST", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "--name",
      "X",
      "--ibmi-tools",
      join(tmpDir, "does-not-exist.yaml"),
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/ibmi-tools path not found/);
    expect(process.exitCode).toBe(1);
  });

  it("apply <dir> aborts before any POST when a manifest is malformed", async () => {
    // a-good sorts first, so the OLD one-by-one loop would have POSTed it
    // before hitting z-bad. The two-phase parse must catch z-bad first and
    // POST nothing — no partial, half-applied deployment.
    tmpFile("a-good.agent.yaml", ["name: Good One", "model: anthropic:x"].join("\n"));
    tmpFile("z-bad.agent.yaml", "name: [unterminated");

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "apply",
      "-f",
      tmpDir,
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Invalid YAML/);
    expect(process.exitCode).toBe(1);
  });

  it("apply <dir> enforces client-side validation (bad model) before any POST", async () => {
    tmpFile(
      "bad-model.agent.yaml",
      ["name: Bad Model", "model: nocolon"].join("\n"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "apply",
      "-f",
      tmpDir,
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Invalid --model/);
    expect(process.exitCode).toBe(1);
  });

  it("apply <dir> --dry-run emits one JSON document with a plans array", async () => {
    tmpFile("one.agent.yaml", ["name: One", "model: anthropic:x"].join("\n"));
    tmpFile("two.agent.yaml", ["name: Two", "model: anthropic:y"].join("\n"));

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "apply",
      "-f",
      tmpDir,
      "--dry-run",
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(stdout);
    expect(parsed.dry_run).toBe(true);
    expect(Array.isArray(parsed.plans)).toBe(true);
    expect(parsed.plans).toHaveLength(2);
  });

  it("apply surfaces tools_written and stripped_overrides in table output", async () => {
    requestFn.mockResolvedValueOnce({
      component_id: "demo-agent",
      stage: "published",
      version: 2,
      action: "updated",
      config_keys: [],
      stripped_overrides: ["tools", "db"],
      tools_written: 2,
    });
    const file = tmpFile(
      "agent.yaml",
      ["name: Demo", "model: anthropic:claude-sonnet-4-6"].join("\n"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "apply",
      "-f",
      file,
      "-o",
      "table",
      ...BASE,
    ]);

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/2 IBM i tool\(s\) written/);
    expect(stderr).toMatch(/Ignored protected override key\(s\): tools, db/);
  });

  it("create rejects a manifest with an unknown key (typo) before any POST", async () => {
    const file = tmpFile(
      "agent.yaml",
      [
        "name: Demo",
        "model: anthropic:claude-sonnet-4-6",
        "instructionz: typo for instructions",
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

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Unknown field\(s\) in manifest: instructionz/);
    expect(process.exitCode).toBe(1);
  });

  it("apply <dir> rejects a manifest with an unknown key before any POST", async () => {
    tmpFile(
      "typo.agent.yaml",
      ["name: Typo", "model: anthropic:x", "bogus_key: 1"].join("\n"),
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "apply",
      "-f",
      tmpDir,
      ...BASE,
    ]);

    expect(requestFn).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/Unknown field\(s\) in manifest: bogus_key/);
    expect(process.exitCode).toBe(1);
  });

  it("create -o json emits uncolorized, parseable JSON", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "create",
      "--name",
      "Demo",
      "-o",
      "json",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    // No ANSI escape sequences in JSON output.
    expect(stdout).not.toMatch(/\x1b\[/);
    const parsed = JSON.parse(stdout);
    expect(parsed.component_id).toBe("demo-agent");
    expect(parsed.action).toBe("created");
  });
});
