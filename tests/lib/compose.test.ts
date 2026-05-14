import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveService, runCompose } from "../../src/lib/compose.js";
import { generateMultiCompose } from "../../src/lib/templates/multi-compose.js";
import {
  SAMPLE_ENV_WITH_SYSTEM,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../../src/lib/ui.js", () => ({
  error: vi.fn(),
  bold: (s: string) => s,
}));

describe("compose", () => {
  describe("resolveService", () => {
    it("returns service name as-is", () => {
      expect(resolveService("api")).toBe("api");
    });

    it("strips ixora- prefix", () => {
      expect(resolveService("ixora-api")).toBe("api");
    });

    it("strips trailing replica number", () => {
      expect(resolveService("ixora-api-1")).toBe("api");
    });

    it("handles container name with just prefix", () => {
      expect(resolveService("ixora-ui-1")).toBe("ui");
    });

    it("preserves multi-part service names", () => {
      expect(resolveService("ibmi-mcp-server")).toBe("ibmi-mcp-server");
    });

    it("strips both prefix and suffix from full container name", () => {
      expect(resolveService("ixora-ibmi-mcp-server-1")).toBe("ibmi-mcp-server");
    });
  });

  describe("generateMultiCompose (single system)", () => {
    let tmpDir: string;
    let envFile: string;
    let configFile: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "ixora-compose-"));
      envFile = join(tmpDir, ".env");
      configFile = join(tmpDir, "ixora-systems.yaml");
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("generates valid compose with all services", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("services:");
      expect(content).toContain("agentos-db:");
      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");
      expect(content).toContain("ui:");
      expect(content).toContain("volumes:");
    });

    it("includes correct image references", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-mcp-server");
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-api");
      expect(content).toContain("ghcr.io/ibmi-agi/ixora-ui");
    });

    it("includes correct port mappings", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("18000:8000");
      expect(content).toContain("13000:3000");
    });

    it("includes health checks", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("healthcheck:");
      expect(content).toContain("pg_isready");
      expect(content).toContain("healthz");
    });

    it("includes system-specific environment variable references", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("${IXORA_VERSION:-latest}");
    });
  });

  describe("generateMultiCompose (CLI mode)", () => {
    let tmpDir: string;
    let envFile: string;
    let configFile: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "ixora-compose-cli-"));
      envFile = join(tmpDir, ".env");
      configFile = join(tmpDir, "ixora-systems.yaml");
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    function assertCliCompose(content: string): void {
      // no MCP container
      expect(content).not.toContain("mcp-default:");
      expect(content).not.toContain("ghcr.io/ibmi-agi/ixora-mcp-server");
      expect(content).not.toContain("http://mcp-default:3010/mcp");
      // api runs in CLI mode with the system's creds
      expect(content).toContain('IXORA_CLI_MODE: "true"');
      expect(content).toContain("IBMI_HOST: ${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("IBMI_USER: ${SYSTEM_DEFAULT_USER}");
      expect(content).toContain("IBMI_PASS: ${SYSTEM_DEFAULT_PASS}");
      expect(content).toContain("IBMI_PORT: ${SYSTEM_DEFAULT_PORT:-8076}");
      // api no longer depends on the MCP service
      const apiBlock = content.slice(content.indexOf("api-default:"));
      const dependsOn = apiBlock.slice(
        apiBlock.indexOf("depends_on:"),
        apiBlock.indexOf("healthcheck:"),
      );
      expect(dependsOn).toContain("agentos-db:");
      expect(dependsOn).not.toContain("mcp-default");
      // db, api, ui blocks still present (ui is gated by profiles:["full"])
      expect(content).toContain("agentos-db:");
      expect(content).toContain("api-default:");
      expect(content).toContain("ui:");
    }

    it("triggers on the `cli` stack profile (IXORA_PROFILE=cli)", () => {
      writeFileSync(
        envFile,
        SAMPLE_ENV_WITH_SYSTEM.replace(
          "IXORA_PROFILE='full'",
          "IXORA_PROFILE='cli'",
        ),
      );
      assertCliCompose(generateMultiCompose(envFile, configFile));
    });

    it("triggers on the IXORA_CLI_MODE override (any profile)", () => {
      writeFileSync(envFile, `${SAMPLE_ENV_WITH_SYSTEM}IXORA_CLI_MODE=true\n`);
      assertCliCompose(generateMultiCompose(envFile, configFile));
    });

    it("leaves the MCP path intact for the default profile", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("mcp-default:");
      expect(content).toContain("http://mcp-default:3010/mcp");
      expect(content).not.toContain('IXORA_CLI_MODE: "true"');
    });
  });

  describe("runCompose", () => {
    let mockExeca: ReturnType<typeof vi.fn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      const execaMod = await import("execa");
      mockExeca = execaMod.execa as unknown as ReturnType<typeof vi.fn>;
      exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as unknown as (code?: number) => never);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("throws Error when throwOnError is true and command fails", async () => {
      mockExeca.mockRejectedValueOnce({ exitCode: 1 });

      await expect(
        runCompose("docker compose", ["pull"], { throwOnError: true }),
      ).rejects.toThrow("Compose command failed (exit 1): pull");
    });

    it("calls process.exit when throwOnError is not set and command fails", async () => {
      mockExeca.mockRejectedValueOnce({ exitCode: 2 });

      await runCompose("docker compose", ["up", "-d"]);

      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it("returns result on success with throwOnError true", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      });

      const result = await runCompose("docker compose", ["ps"], {
        throwOnError: true,
      });

      expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    });

    it("includes failed args in thrown error message", async () => {
      mockExeca.mockRejectedValueOnce({ exitCode: 3 });

      await expect(
        runCompose("docker compose", ["up", "-d", "--remove-orphans"], {
          throwOnError: true,
        }),
      ).rejects.toThrow("up -d --remove-orphans");
    });
  });
});
