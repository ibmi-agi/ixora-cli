import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteServerUnavailableError } from "@worksofadam/agentos-sdk";
import { handleError } from "../../src/lib/agentos-errors.js";

// Regression: a 503 from AgentOS carries an actionable backend detail (e.g.
// "`croniter` not installed ...") in err.message. handleError must surface it
// rather than masking every 503 as a generic "Server unavailable. Is the
// system running?" — which is doubly misleading because a 503 means the server
// *responded* (a truly-down server surfaces as a connection error instead).

describe("handleError — RemoteServerUnavailableError (503)", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const savedExitCode = process.exitCode;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
  });

  const stderr = () =>
    stderrSpy.mock.calls.map((c) => String(c[0])).join("");

  it("surfaces the backend detail instead of the generic outage message", () => {
    const err = new RemoteServerUnavailableError(
      "`croniter` not installed. Please install it using `pip install agno[scheduler]`",
    );

    expect(() => handleError(err)).toThrow("__exit__");

    const out = stderr();
    expect(out).toContain("Server unavailable:");
    expect(out).toContain("croniter"); // the real, actionable detail is shown
    expect(out).not.toMatch(/Is the system running/); // not masked
    expect(process.exitCode).toBe(2);
  });

  it("falls back to the 'is it running?' hint when the 503 has no detail", () => {
    const err = new RemoteServerUnavailableError("");

    expect(() => handleError(err)).toThrow("__exit__");

    const out = stderr();
    expect(out).toContain("Is the system running?");
    expect(process.exitCode).toBe(2);
  });
});
