import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK so every list/search/runs/stats method returns a known shape.
// The mocks are reused across all parameter cases — each test asserts what the
// CLI printed, not how the SDK was called.

const ARRAY_PAYLOAD = {
  data: [{ id: "a", extra: "x" }, { id: "b", extra: "y" }],
  meta: { page: 1, limit: 20, total_pages: 1, total_count: 2 },
};
const BARE_ARRAY = [
  { id: "a", extra: "x" },
  { id: "b", extra: "y" },
];

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    agents = {
      list: vi.fn().mockResolvedValue(BARE_ARRAY),
    };
    teams = {
      list: vi.fn().mockResolvedValue(BARE_ARRAY),
    };
    workflows = {
      list: vi.fn().mockResolvedValue(BARE_ARRAY),
    };
    models = {
      list: vi.fn().mockResolvedValue(BARE_ARRAY),
    };
    components = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    sessions = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
      getRuns: vi.fn().mockResolvedValue(BARE_ARRAY),
    };
    memories = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    knowledge = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
      search: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    evals = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    approvals = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    schedules = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
      listRuns: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    registry = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
    traces = {
      list: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
      getStats: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
      search: vi.fn().mockResolvedValue(ARRAY_PAYLOAD),
    };
  }
  return { AgentOSClient };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

// Each row: [name, argv-after-"ixora", expected-projection]
// Every verb is invoked with `--json id --url http://test` so the resolver
// short-circuits and the projection runs through the same output chokepoint.
// Expected output is the projected flat array [{id:"a"}, {id:"b"}].
const PROJECTED = `${JSON.stringify(
  [{ id: "a" }, { id: "b" }],
  null,
  2,
)}\n`;

const CASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["agents list", ["agents", "list"]],
  ["teams list", ["teams", "list"]],
  ["workflows list", ["workflows", "list"]],
  ["models list", ["models", "list"]],
  ["components list", ["components", "list"]],
  ["sessions list", ["sessions", "list"]],
  ["sessions runs", ["sessions", "runs", "sess-1"]],
  ["memories list", ["memories", "list"]],
  ["knowledge list", ["knowledge", "list"]],
  ["knowledge search", ["knowledge", "search", "query"]],
  ["evals list", ["evals", "list"]],
  ["approvals list", ["approvals", "list"]],
  ["schedules list", ["schedules", "list"]],
  ["schedules runs", ["schedules", "runs", "sched-1"]],
  ["registries list", ["registries", "list"]],
  ["traces list", ["traces", "list"]],
  ["traces stats", ["traces", "stats"]],
  ["traces search", ["traces", "search"]],
];

describe("--json projection across runtime list/search/runs/stats verbs", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  it.each(CASES)("`%s --json id` emits projected flat array", async (_name, argv) => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      ...argv,
      "--json",
      "id",
      "--url",
      "http://test",
    ]);

    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toBe(PROJECTED);
  });
});
