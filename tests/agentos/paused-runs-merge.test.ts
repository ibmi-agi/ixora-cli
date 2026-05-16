import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifies the bug fix from /goal #3: when an agent run pauses, then a
// `continue` re-pauses, the rewritten cache must preserve the original
// session_id (the AgentOS RunStarted event omits session_id on the second
// pause, which used to clobber the cache and break the next --confirm).

const tmpHome = mkdtempSync(join(tmpdir(), "ixora-paused-test-"));
mkdirSync(join(tmpHome, ".ixora"), { recursive: true });

vi.mock("../../src/lib/constants.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/constants.js")
  >("../../src/lib/constants.js");
  return {
    ...actual,
    IXORA_DIR: join(tmpHome, ".ixora"),
  };
});

const {
  mergePausedRun,
  readPausedRun,
  writePausedRun,
  listPausedRuns,
  deletePausedRun,
} = await import("../../src/lib/agentos-paused-runs.js");

describe("mergePausedRun", () => {
  afterEach(() => {
    deletePausedRun("run-merge");
  });

  it("preserves prior session_id when the new state has session_id=null (re-pause case)", () => {
    writePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: "sess-original",
      resource_type: "agent",
      paused_at: "2026-05-15T19:00:00Z",
      tools: [
        {
          tool_call_id: "tc-1",
          tool_name: "first_tool",
          tool_args: {},
        },
      ],
    });

    mergePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: null,
      resource_type: "agent",
      paused_at: "2026-05-15T19:05:00Z",
      tools: [
        {
          tool_call_id: "tc-2",
          tool_name: "second_tool",
          tool_args: {},
        },
      ],
    });

    const after = readPausedRun("run-merge");
    expect(after?.session_id).toBe("sess-original");
    expect(after?.tools).toHaveLength(1);
    expect(after?.tools[0]?.tool_call_id).toBe("tc-2");
  });

  it("uses incoming session_id when prior cache is absent", () => {
    mergePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: "sess-fresh",
      resource_type: "agent",
      paused_at: "2026-05-15T19:00:00Z",
      tools: [],
    });
    expect(readPausedRun("run-merge")?.session_id).toBe("sess-fresh");
  });

  it("uses incoming session_id when both prior and new have one (does not regress)", () => {
    writePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: "sess-old",
      resource_type: "agent",
      paused_at: "2026-05-15T19:00:00Z",
      tools: [],
    });
    mergePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: "sess-new",
      resource_type: "agent",
      paused_at: "2026-05-15T19:05:00Z",
      tools: [],
    });
    expect(readPausedRun("run-merge")?.session_id).toBe("sess-new");
  });

  it("preserves prompt across re-pauses when the new state omits it", () => {
    writePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: "sess-1",
      resource_type: "agent",
      paused_at: "2026-05-15T19:00:00Z",
      prompt: "audit profiles for impersonation",
      tools: [],
    });
    mergePausedRun({
      agent_id: "ag-1",
      run_id: "run-merge",
      session_id: "sess-1",
      resource_type: "agent",
      paused_at: "2026-05-15T19:05:00Z",
      tools: [],
    });
    expect(readPausedRun("run-merge")?.prompt).toBe(
      "audit profiles for impersonation",
    );
  });
});

describe("listPausedRuns", () => {
  beforeEach(() => {
    for (const s of listPausedRuns()) deletePausedRun(s.run_id);
  });
  afterEach(() => {
    for (const s of listPausedRuns()) deletePausedRun(s.run_id);
  });

  it("returns an empty array when nothing is cached", () => {
    expect(listPausedRuns()).toEqual([]);
  });

  it("returns cached entries newest-first by paused_at", () => {
    writePausedRun({
      agent_id: "ag-1",
      run_id: "older",
      session_id: "s",
      resource_type: "agent",
      paused_at: "2026-05-15T18:00:00Z",
      tools: [],
    });
    writePausedRun({
      agent_id: "ag-1",
      run_id: "newer",
      session_id: "s",
      resource_type: "agent",
      paused_at: "2026-05-15T19:00:00Z",
      tools: [],
    });
    const out = listPausedRuns();
    expect(out.map((s) => s.run_id)).toEqual(["newer", "older"]);
  });

  it("skips files that aren't valid JSON instead of throwing", () => {
    writePausedRun({
      agent_id: "ag-1",
      run_id: "good",
      session_id: "s",
      resource_type: "agent",
      paused_at: "2026-05-15T18:00:00Z",
      tools: [],
    });
    // Corrupt one entry — listPausedRuns should skip it, not crash.
    const cacheDir = join(tmpHome, ".ixora", "agentos-paused-runs");
    const badFile = join(cacheDir, "bad.json");
    require("node:fs").writeFileSync(badFile, "{not json", "utf-8");
    expect(() => listPausedRuns()).not.toThrow();
    expect(listPausedRuns().map((s) => s.run_id)).toEqual(["good"]);
    rmSync(badFile);
  });
});
