import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let configFile: string;
let envFile: string;

vi.mock("../../src/lib/constants.js", async (importOriginal) => {
  const mod = (await importOriginal()) as typeof import(
    "../../src/lib/constants.js"
  );
  return {
    ...mod,
    get SYSTEMS_CONFIG() {
      return configFile;
    },
    get ENV_FILE() {
      return envFile;
    },
    get COMPOSE_FILE() {
      return join(tmpDir, "docker-compose.yml");
    },
  };
});

const {
  resolveAgentOSTarget,
  resolveAgentOSTargetOrExit,
  ResolverError,
  runningSystemsFromPsJson,
} = await import("../../src/lib/agentos-resolver.js");
const { DOCKER_PS_NDJSON, PODMAN_PS_JSON } = await import(
  "../helpers/fixtures.js"
);

function runningOf(...ids: string[]): () => Promise<Set<string>> {
  return async () => new Set(ids);
}

describe("runningSystemsFromPsJson", () => {
  it("extracts api-<id> systems from docker compose v2 NDJSON", () => {
    expect(runningSystemsFromPsJson(DOCKER_PS_NDJSON)).toEqual(
      new Set(["default"]),
    );
  });

  it("extracts api-<id> systems from podman-compose ps JSON (service in labels)", () => {
    expect(runningSystemsFromPsJson(PODMAN_PS_JSON)).toEqual(
      new Set(["default"]),
    );
  });

  it("ignores non-running and non-api services", () => {
    const out = JSON.stringify([
      { Service: "api-dev", State: "exited" },
      { Service: "ui", State: "running" },
    ]);
    expect(runningSystemsFromPsJson(out)).toEqual(new Set());
  });

  it("returns empty set for empty output", () => {
    expect(runningSystemsFromPsJson("")).toEqual(new Set());
  });
});

describe("resolveAgentOSTarget", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ixora-resolve-"));
    configFile = join(tmpDir, "ixora-systems.yaml");
    envFile = join(tmpDir, ".env");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("--url override skips system resolution entirely", async () => {
    const ctx = await resolveAgentOSTarget(
      { url: "http://example:9000" },
      { discoverRunning: runningOf() },
    );
    expect(ctx.baseUrl).toBe("http://example:9000");
    expect(ctx.systemId).toBeUndefined();
  });

  it("picks the only running managed system implicitly", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
`,
    );
    const ctx = await resolveAgentOSTarget(
      {},
      { discoverRunning: runningOf("prod1") },
    );
    expect(ctx.systemId).toBe("prod1");
    expect(ctx.baseUrl).toBe("http://localhost:18000");
  });

  it("picks the only external system implicitly (no docker required)", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: personal
    name: 'X'
    kind: external
    url: 'http://localhost:8080'
`,
    );
    const ctx = await resolveAgentOSTarget(
      {},
      { discoverRunning: runningOf() },
    );
    expect(ctx.systemId).toBe("personal");
    expect(ctx.baseUrl).toBe("http://localhost:8080");
  });

  it("requires --system when 1 managed running + 1 external (ambiguous)", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
    );

    const err = await resolveAgentOSTarget(
      {},
      { discoverRunning: runningOf("prod1") },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ResolverError);
    if (!(err instanceof ResolverError)) throw new Error("unreachable");
    expect(err.reason).toBe("ambiguous");
    expect(err.message).toMatch(/Multiple systems are available/);
    expect(err.available?.map((s) => s.id)).toEqual(["prod1", "cloud"]);
    expect(err.defaultSystemId).toBeUndefined();
  });

  it("ambiguous ResolverError carries the configured-but-unavailable default", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
    );
    writeFileSync(envFile, "IXORA_DEFAULT_SYSTEM='gone'\n");

    const err = await resolveAgentOSTarget(
      {},
      { discoverRunning: runningOf("prod1") },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ResolverError);
    if (!(err instanceof ResolverError)) throw new Error("unreachable");
    expect(err.reason).toBe("ambiguous");
    expect(err.message).toMatch(
      /Default system 'gone' is configured but not currently available/,
    );
    expect(err.defaultSystemId).toBe("gone");
  });

  it("--system targets external without requiring a running container", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://agentos.example.com'
`,
    );
    const ctx = await resolveAgentOSTarget(
      { system: "cloud" },
      { discoverRunning: runningOf("prod1") },
    );
    expect(ctx.systemId).toBe("cloud");
    expect(ctx.baseUrl).toBe("https://agentos.example.com");
  });

  it("--system on a not-running managed system errors clearly", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
`,
    );

    const err = await resolveAgentOSTarget(
      { system: "prod1" },
      { discoverRunning: runningOf() },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ResolverError);
    if (!(err instanceof ResolverError)) throw new Error("unreachable");
    expect(err.reason).toBe("not-running");
    expect(err.message).toMatch(/is not running/);
    expect(err.available).toBeUndefined();
  });

  it("port stability: external between two managed does NOT shift the second managed's port", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
  - id: sandbox
    name: 'S'
    kind: managed
    mode: full
`,
    );
    const ctx = await resolveAgentOSTarget(
      { system: "sandbox" },
      { discoverRunning: runningOf("sandbox") },
    );
    // sandbox is the 2nd managed entry → port 18001 (not 18002 by raw index).
    expect(ctx.baseUrl).toBe("http://localhost:18001");
  });

  it("--key flag overrides SYSTEM_<ID>_AGENTOS_KEY env", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
    );
    writeFileSync(envFile, "SYSTEM_CLOUD_AGENTOS_KEY='stored'\n");

    const ctx = await resolveAgentOSTarget(
      { system: "cloud", key: "override" },
      { discoverRunning: runningOf() },
    );
    expect(ctx.securityKey).toBe("override");
  });

  it("env auth key flows through for external systems", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
    );
    writeFileSync(envFile, "SYSTEM_CLOUD_AGENTOS_KEY='sk-from-env'\n");

    const ctx = await resolveAgentOSTarget(
      { system: "cloud" },
      { discoverRunning: runningOf() },
    );
    expect(ctx.securityKey).toBe("sk-from-env");
  });

  it("IXORA_DEFAULT_SYSTEM picks ambiguous case when set and available", async () => {
    writeFileSync(
      configFile,
      `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
    );
    writeFileSync(envFile, "IXORA_DEFAULT_SYSTEM='cloud'\n");

    const ctx = await resolveAgentOSTarget(
      {},
      { discoverRunning: runningOf("prod1") },
    );
    expect(ctx.systemId).toBe("cloud");
  });

  describe("resolveAgentOSTargetOrExit", () => {
    it("prints `Error:` to stderr and exits 1 on resolution failure", async () => {
      writeFileSync(
        configFile,
        `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
      );

      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(((_code?: number) => {
          throw new Error("__exit__");
        }) as never);
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      await expect(
        resolveAgentOSTargetOrExit(
          {},
          { discoverRunning: runningOf("prod1") },
        ),
      ).rejects.toThrow("__exit__");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errMsg = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(errMsg).toMatch(/Error:/);
      expect(errMsg).toMatch(/Multiple systems are available/);

      exitSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it("returns the resolved context untouched on success", async () => {
      writeFileSync(
        configFile,
        `systems:
  - id: personal
    name: 'X'
    kind: external
    url: 'http://localhost:8080'
`,
      );
      const ctx = await resolveAgentOSTargetOrExit(
        {},
        { discoverRunning: runningOf() },
      );
      expect(ctx.systemId).toBe("personal");
      expect(ctx.baseUrl).toBe("http://localhost:8080");
    });
  });
});
