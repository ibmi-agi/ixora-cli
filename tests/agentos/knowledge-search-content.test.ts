import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Asserts `knowledge search` content truncation is table-only:
//   * -o json carries the full chunk text (scripts pipe .data[].content)
//   * -o table truncates CONTENT to 80 chars for display
// The content record from `knowledge get` is metadata-only, so search JSON
// is the only path to the indexed text.

const searchFn = vi.fn();

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    knowledge = { search: searchFn };
  }
  return { AgentOSClient };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

const BASE = ["--url", "http://test"];
const LONG_CONTENT = "x".repeat(200);

describe("knowledge search content truncation", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    process.exitCode = 0;
    searchFn.mockReset();
    searchFn.mockResolvedValue({
      data: [
        {
          id: "chunk-1",
          content: LONG_CONTENT,
          name: "doc-1",
          reranking_score: 0.9,
        },
      ],
      meta: { page: 1, limit: 20, total_pages: 1, total_count: 1 },
    });
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("-o json carries the full chunk content", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "search",
      "query",
      "-o",
      "json",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(stdout) as {
      data: Array<{ content: string }>;
    };
    expect(parsed.data[0]?.content).toBe(LONG_CONTENT);
  });

  it("-o table truncates content to 80 chars", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "knowledge",
      "search",
      "query",
      "-o",
      "table",
      ...BASE,
    ]);

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toContain(`${"x".repeat(77)}...`);
    expect(stdout).not.toContain("x".repeat(81));
  });
});
