import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE_SPEC = {
  openapi: "3.1.0",
  info: { title: "FastAPI", version: "0.1.0" },
  paths: { "/health": { get: { operationId: "health" } } },
};

const requestFn = vi.fn().mockResolvedValue(FIXTURE_SPEC);

vi.mock("@worksofadam/agentos-sdk", () => {
  class AgentOSClient {
    request = requestFn;
  }
  return { AgentOSClient };
});

const { createProgram } = await import("../../src/cli.js");
const { resetClient } = await import("../../src/lib/agentos-client.js");
const { clearAgentOSContext } = await import(
  "../../src/lib/agentos-context.js"
);

describe("docs spec", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClient();
    clearAgentOSContext();
    requestFn.mockClear();
    requestFn.mockResolvedValue(FIXTURE_SPEC);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  it("emits the OpenAPI JSON bytewise-stable and calls /openapi.json once", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "ixora",
      "docs",
      "spec",
      "--url",
      "http://test",
    ]);

    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn).toHaveBeenCalledWith("GET", "/openapi.json");

    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toBe(`${JSON.stringify(FIXTURE_SPEC, null, 2)}\n`);
  });
});
