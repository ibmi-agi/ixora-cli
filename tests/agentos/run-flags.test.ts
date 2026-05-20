import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the --background / --bypass-confirmations flag guards on
// `agents run` and the `runs` command — each invalid combination must fail
// fast (exit 1) before any network call.

const getFn = vi.fn().mockResolvedValue({ id: "ag-1", name: "Agent" });
const requestFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
    agents = { get: getFn, run: vi.fn(), continue: vi.fn() };
    teams = { get: vi.fn(), run: vi.fn(), continue: vi.fn() };
    workflows = { get: vi.fn(), run: vi.fn(), continue: vi.fn() };
  }
  return { AgentOSClient };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

describe("agents run / runs flag validation", () => {
  let stdout: string[];
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    getFn.mockClear();
    requestFn.mockClear();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    stdout = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("rejects --background combined with --stream", async () => {
    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "run",
      "ag-1",
      "hi",
      "--background",
      "--stream",
      "--url",
      "http://test",
    ]);
    expect(process.exitCode).toBe(1);
    expect(requestFn).not.toHaveBeenCalled();
  });

  it("rejects --bypass-confirmations combined with --interactive", async () => {
    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "run",
      "ag-1",
      "hi",
      "--bypass-confirmations",
      "-i",
      "--url",
      "http://test",
    ]);
    expect(process.exitCode).toBe(1);
    expect(requestFn).not.toHaveBeenCalled();
  });

  it("--background --dry-run emits a plan and makes no run request", async () => {
    await createProgram().parseAsync([
      "node",
      "ixora",
      "agents",
      "run",
      "ag-1",
      "hi",
      "--background",
      "--dry-run",
      "--url",
      "http://test",
    ]);
    const out = JSON.parse(stdout.join(""));
    expect(out.dry_run).toBe(true);
    expect(out.action).toBe("agents.run.background");
    expect(out.payload.background).toBe(true);
    expect(out.payload.stream).toBe(false);
    expect(getFn).toHaveBeenCalledOnce();
    expect(requestFn).not.toHaveBeenCalled();
  });
});
