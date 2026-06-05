import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Asserts `knowledge bases` lists the knowledge_instances from GET /config:
//   * table output renders each instance's id/name/db_id/table
//   * -o json emits the raw instances array (uncolorized)
//   * an absent/empty knowledge_instances renders cleanly (no crash)

const getConfigFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    getConfig = getConfigFn;
  }
  return { AgentOSClient };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

const BASE = ["--url", "http://test"];
const INSTANCES = [
  { id: "kb-1", name: "User Documents", db_id: "default", table: "kb_user" },
  { id: "kb-2", name: "Runbooks", db_id: "default", table: "kb_runbooks" },
];

describe("knowledge bases", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    process.exitCode = 0;
    getConfigFn.mockReset();
    getConfigFn.mockResolvedValue({
      knowledge: { knowledge_instances: INSTANCES },
    });
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists instances from /config in table output", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "bases",
      "-o",
      "table",
      ...BASE,
    ]);

    expect(getConfigFn).toHaveBeenCalledTimes(1);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toMatch(/kb-1/);
    expect(stdout).toMatch(/User Documents/);
    expect(stdout).toMatch(/kb-2/);
    expect(stdout).toMatch(/Runbooks/);
  });

  it("-o json emits the raw instances array, uncolorized", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "bases",
      "-o",
      "json",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).not.toMatch(/\x1b\[/);
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(INSTANCES);
  });

  it("renders cleanly when knowledge_instances is absent", async () => {
    getConfigFn.mockResolvedValueOnce({});

    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "bases",
      "-o",
      "json",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(JSON.parse(stdout)).toEqual([]);
    expect(process.exitCode).toBe(0);
  });
});
