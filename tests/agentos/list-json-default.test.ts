import { describe, it, expect, vi, beforeEach } from "vitest";

// Pins the default JSON contract for list verbs: bare `--json` / `-o json` /
// piped output emits the rows EXACTLY as passed to outputList — the full API
// payload for commands that pass raw rows through — inside the {data, meta}
// envelope. Filtering fields is opt-in via `--json <fields>` (covered by
// list-projection.test.ts). The `extra` field below stands in for any API
// field not shown in the table view: it must survive into `-o json` output.
//
// v0.4.14 wrongly projected default JSON rows to the table columns; this
// suite exists so that regression cannot ship again. Commands that pre-map
// rows for display (evals, approvals, schedules, registries, knowledge
// search) are intentionally not asserted here — their mapping is per-command
// display logic, not the outputList chokepoint contract.

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

// Every command here passes raw rows straight to outputList.
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
  ["traces list", ["traces", "list"]],
  ["traces stats", ["traces", "stats"]],
  ["traces search", ["traces", "search"]],
];

describe("`-o json` on list verbs passes raw rows through (full payload)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  it.each(CASES)(
    "`%s -o json` emits unprojected rows, fields beyond the table columns intact",
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
      expect(parsed.data).toEqual([
        { id: "a", extra: "x" },
        { id: "b", extra: "y" },
      ]);
    },
  );

  it("`agents list -o json` emits the exact full-payload envelope with meta", async () => {
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
        { id: "a", extra: "x" },
        { id: "b", extra: "y" },
      ],
      meta: { page: 1, limit: 20, total_pages: 1, total_count: 2 },
    });
  });
});
