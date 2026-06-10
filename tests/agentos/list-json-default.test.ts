import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for `-o json` on list verbs: JSON rows must mirror the
// table columns (the outputList `keys` projection, null-filled for keys the
// API omits), not dump the raw API payload. The mock rows carry an `extra`
// field that only appears in the raw payload — if it ever shows up in
// `-o json` output, the projection regressed. Full objects remain reachable
// via `<group> get <id>` or an explicit `--json <fields>` projection
// (covered by list-projection.test.ts).

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

describe("`-o json` on list verbs projects rows to the table columns", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  it.each(CASES)(
    "`%s -o json` emits projected rows, no raw-payload leak",
    async (_name, argv) => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "ixora",
        ...argv,
        "-o",
        "json",
        "--url",
        "http://test",
      ]);

      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const parsed = JSON.parse(written) as {
        data: Record<string, unknown>[];
      };
      expect(Array.isArray(parsed.data)).toBe(true);
      expect(parsed.data).toHaveLength(2);
      for (const row of parsed.data) {
        expect(row).not.toHaveProperty("extra");
      }
    },
  );

  it("`agents list -o json` emits the exact projected envelope, null-filling missing keys", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "agents",
      "list",
      "-o",
      "json",
      "--url",
      "http://test",
    ]);

    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(written)).toEqual({
      data: [
        { id: "a", name: null, description: null },
        { id: "b", name: null, description: null },
      ],
      meta: { page: 1, limit: 20, total_pages: 1, total_count: 2 },
    });
  });
});
