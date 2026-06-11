import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Command-surface tests for `ixora chat` (src/agentos/chat.ts):
//   - TTY guard (stdin AND stdout must be TTYs; refuse before any work)
//   - --agent/--team/--workflow mutual exclusion (Commander .conflicts())
//   - option passthrough to ChatController.start (entity/session/bypass)
//   - self-resolution: ambiguity prompt → re-resolve → setAgentOSContext
//     BEFORE the controller is constructed/started
//   - prompt cancellation → quiet exit 130
//
// The TUI layer (ChatApp/ChatController) is fully mocked — no terminal is
// ever created; assertions run against the constructor/start spies instead.

const chatAppCtorSpy = vi.fn();
const controllerCtorSpy = vi.fn();
const startSpy = vi.fn();
const selectSpy = vi.fn();
const resolveSpy = vi.fn();
const setCtxSpy = vi.fn();

vi.mock("../../src/lib/chat/app.js", () => ({
  ChatApp: class {
    constructor(...args: unknown[]) {
      chatAppCtorSpy(...args);
    }
  },
}));

vi.mock("../../src/lib/chat/runner.js", () => ({
  ChatController: class {
    constructor(...args: unknown[]) {
      controllerCtorSpy(...args);
    }
    start = (...args: unknown[]) => startSpy(...args) as Promise<void>;
  },
}));

vi.mock("@inquirer/prompts", () => ({
  select: (...args: unknown[]) => selectSpy(...args) as Promise<string>,
}));

vi.mock("../../src/lib/agentos-resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/agentos-resolver.js")>();
  return {
    ...actual,
    resolveAgentOSTarget: (...args: unknown[]) => resolveSpy(...args),
  };
});

vi.mock("../../src/lib/agentos-context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/agentos-context.js")>();
  return {
    ...actual,
    setAgentOSContext: (...args: unknown[]) => setCtxSpy(...args),
  };
});

import type { SystemConfig } from "../../src/lib/systems.js";

const CTX = {
  baseUrl: "http://localhost:18000",
  securityKey: undefined,
  timeout: 60,
  systemId: "alpha",
};

const SYS_ALPHA: SystemConfig = {
  id: "alpha",
  name: "alpha",
  kind: "managed",
  mode: "full",
};
const SYS_BETA: SystemConfig = {
  id: "beta",
  name: "beta",
  kind: "external",
  url: "http://beta:8000",
};

/**
 * Fresh imports per test: chatCommand is a module-level Commander singleton
 * and option values persist on the instance across parses. ResolverError is
 * re-imported in the same generation so `instanceof` inside chat.ts matches
 * errors constructed by the tests.
 */
async function loadChat() {
  vi.resetModules();
  const { ResolverError } = await import("../../src/lib/agentos-resolver.js");
  const { chatCommand } = await import("../../src/agentos/chat.js");
  return { chatCommand, ResolverError };
}

type StdStream = NodeJS.ReadStream | NodeJS.WriteStream;

const stdinTTYDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function setTTY(stream: StdStream, value: boolean): void {
  Object.defineProperty(stream, "isTTY", { value, configurable: true });
}

function restoreTTY(stream: StdStream, desc?: PropertyDescriptor): void {
  if (desc) {
    Object.defineProperty(stream, "isTTY", desc);
  } else {
    delete (stream as { isTTY?: boolean }).isTTY;
  }
}

describe("ixora chat command surface", () => {
  let stderr: string[];
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    setTTY(process.stdin, true);
    setTTY(process.stdout, true);
    chatAppCtorSpy.mockReset();
    controllerCtorSpy.mockReset();
    selectSpy.mockReset();
    setCtxSpy.mockReset();
    startSpy.mockReset().mockResolvedValue(undefined);
    resolveSpy.mockReset().mockResolvedValue(CTX);
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderr.push(String(s));
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    restoreTTY(process.stdin, stdinTTYDesc);
    restoreTTY(process.stdout, stdoutTTYDesc);
    vi.restoreAllMocks();
  });

  // ── 1. TTY guard ────────────────────────────────────────────────────────

  it("refuses when stdin is not a TTY", async () => {
    const { chatCommand } = await loadChat();
    setTTY(process.stdin, false);

    await chatCommand.parseAsync([], { from: "user" });

    expect(process.exitCode).toBe(1);
    const err = stderr.join("");
    expect(err).toContain("Error:");
    expect(err).toContain("requires an interactive terminal");
    expect(err).toContain("ixora agents run");
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(controllerCtorSpy).not.toHaveBeenCalled();
  });

  it("refuses when stdout is not a TTY even with a TTY stdin", async () => {
    const { chatCommand } = await loadChat();
    setTTY(process.stdout, false);

    await chatCommand.parseAsync([], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toContain("requires an interactive terminal");
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(controllerCtorSpy).not.toHaveBeenCalled();
  });

  it("proceeds when both stdin and stdout are TTYs", async () => {
    const { chatCommand } = await loadChat();

    await chatCommand.parseAsync([], { from: "user" });

    expect(process.exitCode).toBe(0);
    expect(resolveSpy).toHaveBeenCalledOnce();
    expect(setCtxSpy).toHaveBeenCalledWith(CTX);
    expect(controllerCtorSpy).toHaveBeenCalledOnce();
    expect(startSpy).toHaveBeenCalledWith({
      entity: undefined,
      sessionId: undefined,
      bypassConfirmations: false,
    });
  });

  // ── 2. Flag conflicts (Commander .conflicts()) ──────────────────────────

  it.each([
    [["--agent", "a", "--team", "t"]],
    [["--agent", "a", "--workflow", "w"]],
    [["--team", "t", "--workflow", "w"]],
  ])("rejects mutually exclusive entity flags: %j", async (argv) => {
    const { chatCommand } = await loadChat();
    chatCommand.exitOverride();

    await expect(
      chatCommand.parseAsync(argv, { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.conflictingOption" });

    expect(stderr.join("")).toContain("cannot be used with");
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(controllerCtorSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  // ── 3/4. Option passthrough ─────────────────────────────────────────────

  it("passes --session through to controller.start", async () => {
    const { chatCommand } = await loadChat();

    await chatCommand.parseAsync(["--agent", "ag-1", "--session", "sess-42"], {
      from: "user",
    });

    expect(startSpy).toHaveBeenCalledWith({
      entity: { kind: "agent", id: "ag-1" },
      sessionId: "sess-42",
      bypassConfirmations: false,
    });
  });

  it("passes --bypass-confirmations through to controller.start", async () => {
    const { chatCommand } = await loadChat();

    await chatCommand.parseAsync(["--bypass-confirmations"], { from: "user" });

    expect(startSpy).toHaveBeenCalledWith({
      entity: undefined,
      sessionId: undefined,
      bypassConfirmations: true,
    });
  });

  // ── 7. Entity flag mapping ──────────────────────────────────────────────

  it("maps --agent to an agent entity", async () => {
    const { chatCommand } = await loadChat();
    await chatCommand.parseAsync(["--agent", "ag-1"], { from: "user" });
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entity: { kind: "agent", id: "ag-1" } }),
    );
  });

  it("maps --team to a team entity", async () => {
    const { chatCommand } = await loadChat();
    await chatCommand.parseAsync(["--team", "team-1"], { from: "user" });
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entity: { kind: "team", id: "team-1" } }),
    );
  });

  it("maps --workflow to a workflow entity", async () => {
    const { chatCommand } = await loadChat();
    await chatCommand.parseAsync(["--workflow", "wf-1"], { from: "user" });
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entity: { kind: "workflow", id: "wf-1" } }),
    );
  });

  // ── 5. Ambiguity-prompt path ────────────────────────────────────────────

  it("prompts on ambiguity, re-resolves with the pick, and sets context before starting", async () => {
    const { chatCommand, ResolverError } = await loadChat();
    const ctxBeta = {
      baseUrl: "http://beta:8000",
      securityKey: undefined,
      timeout: 60,
      systemId: "beta",
    };
    resolveSpy
      .mockReset()
      .mockImplementationOnce(() => {
        throw new ResolverError("ambiguous", "Multiple systems available.", {
          available: [SYS_ALPHA, SYS_BETA],
          defaultSystemId: "beta",
        });
      })
      .mockResolvedValueOnce(ctxBeta);
    selectSpy.mockResolvedValueOnce("beta");

    await chatCommand.parseAsync([], { from: "user" });

    expect(process.exitCode).toBe(0);
    expect(selectSpy).toHaveBeenCalledOnce();

    // Default-first ordering: the configured default ('beta') leads even
    // though config order is alpha, beta. External systems show their URL.
    const promptArg = selectSpy.mock.calls[0]?.[0] as {
      choices: Array<{ name: string; value: string }>;
    };
    expect(promptArg.choices.map((c) => c.value)).toEqual(["beta", "alpha"]);
    expect(promptArg.choices[0]?.name).toContain("external");
    expect(promptArg.choices[0]?.name).toContain("http://beta:8000");

    // Re-resolved with the picked system
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveSpy.mock.calls[1]?.[0]).toMatchObject({ system: "beta" });

    // Context set with the re-resolved ctx BEFORE the controller exists
    expect(setCtxSpy).toHaveBeenCalledWith(ctxBeta);
    expect(setCtxSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controllerCtorSpy.mock.invocationCallOrder[0]!,
    );
    expect(setCtxSpy.mock.invocationCallOrder[0]).toBeLessThan(
      startSpy.mock.invocationCallOrder[0]!,
    );
  });

  // ── 6. Prompt cancellation ──────────────────────────────────────────────

  it("exits quietly with code 130 when the system prompt is cancelled", async () => {
    const { chatCommand, ResolverError } = await loadChat();
    resolveSpy.mockReset().mockImplementationOnce(() => {
      throw new ResolverError("ambiguous", "Multiple systems available.", {
        available: [SYS_ALPHA, SYS_BETA],
      });
    });
    const cancelled = new Error("cancelled");
    cancelled.name = "ExitPromptError";
    selectSpy.mockRejectedValueOnce(cancelled);

    await chatCommand.parseAsync([], { from: "user" });

    expect(process.exitCode).toBe(130);
    expect(stderr.join("")).toBe("");
    expect(setCtxSpy).not.toHaveBeenCalled();
    expect(controllerCtorSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  // ── Non-ambiguous resolver failures keep the print-and-exit-1 surface ───

  it("writes Error: to stderr and exits 1 on a non-ambiguous resolver failure", async () => {
    const { chatCommand, ResolverError } = await loadChat();
    resolveSpy.mockReset().mockImplementationOnce(() => {
      throw new ResolverError(
        "none-available",
        "No systems are available. Start a managed system with `ixora stack system start <id>`.",
      );
    });

    await chatCommand.parseAsync([], { from: "user" });

    expect(process.exitCode).toBe(1);
    const err = stderr.join("");
    expect(err).toContain("Error:");
    expect(err).toContain("No systems are available");
    expect(selectSpy).not.toHaveBeenCalled();
    expect(controllerCtorSpy).not.toHaveBeenCalled();
  });
});
