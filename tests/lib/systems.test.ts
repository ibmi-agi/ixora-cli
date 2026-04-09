import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readSystems,
  systemCount,
  systemIdExists,
  totalSystemCount,
  addSystem,
  removeSystem,
} from "../../src/lib/systems.js";
import {
  SAMPLE_SYSTEMS_YAML,
  SAMPLE_SYSTEMS_YAML_SINGLE,
  SAMPLE_ENV,
} from "../helpers/fixtures.js";

describe("systems", () => {
  let tmpDir: string;
  let configFile: string;
  let envFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ixora-sys-"));
    configFile = join(tmpDir, "ixora-systems.yaml");
    envFile = join(tmpDir, ".env");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readSystems", () => {
    it("returns empty array for missing file", () => {
      expect(readSystems(configFile)).toEqual([]);
    });

    it("parses multiple systems with profile", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      const systems = readSystems(configFile);

      expect(systems).toHaveLength(3);
      expect(systems[0]).toEqual({
        id: "default",
        name: "myibmi.example.com",
        profile: "full",
        agents: [],
      });
      expect(systems[1]).toEqual({
        id: "dev",
        name: "Development",
        profile: "security",
        agents: ["ibmi-security-assistant", "ibmi-system-health"],
      });
      expect(systems[2]).toEqual({
        id: "prod",
        name: "Production",
        profile: "full",
        agents: [
          "ibmi-security-assistant",
          "ibmi-system-health",
          "ibmi-db-explorer",
        ],
      });
    });

    it("parses single system", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);
      const systems = readSystems(configFile);

      expect(systems).toHaveLength(1);
      expect(systems[0].id).toBe("default");
      expect(systems[0].name).toBe("myibmi.example.com");
      expect(systems[0].profile).toBe("full");
    });
  });

  describe("systemCount", () => {
    it("returns 0 for missing file", () => {
      expect(systemCount(configFile)).toBe(0);
    });

    it("counts systems correctly", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      expect(systemCount(configFile)).toBe(3);
    });
  });

  describe("systemIdExists", () => {
    it("returns false for missing file", () => {
      expect(systemIdExists("dev", configFile)).toBe(false);
    });

    it("returns true for existing system", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      expect(systemIdExists("default", configFile)).toBe(true);
      expect(systemIdExists("dev", configFile)).toBe(true);
      expect(systemIdExists("prod", configFile)).toBe(true);
    });

    it("returns false for non-existing system", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      expect(systemIdExists("staging", configFile)).toBe(false);
    });
  });

  describe("totalSystemCount", () => {
    it("counts all systems from YAML", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      expect(totalSystemCount(envFile, configFile)).toBe(3);
    });

    it("returns 1 with single system", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);
      expect(totalSystemCount(envFile, configFile)).toBe(1);
    });

    it("returns 0 with no YAML file", () => {
      expect(totalSystemCount(envFile, configFile)).toBe(0);
    });
  });

  describe("addSystem", () => {
    it("creates new config file with first system", () => {
      writeFileSync(envFile, "");
      addSystem(
        {
          id: "test",
          name: "Test System",
          profile: "security",
          agents: ["ibmi-security-assistant"],
          host: "test.ibmi.com",
          port: "8076",
          user: "TESTUSER",
          pass: "testpass",
        },
        envFile,
        configFile,
      );

      const systems = readSystems(configFile);
      expect(systems).toHaveLength(1);
      expect(systems[0].id).toBe("test");
      expect(systems[0].profile).toBe("security");

      // Check credentials in env
      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).toContain("SYSTEM_TEST_HOST='test.ibmi.com'");
      expect(envContent).toContain("SYSTEM_TEST_USER='TESTUSER'");
    });

    it("writes profile to YAML", () => {
      writeFileSync(envFile, "");
      addSystem(
        {
          id: "test",
          name: "Test",
          profile: "knowledge",
          agents: [],
          host: "h",
          port: "8076",
          user: "u",
          pass: "p",
        },
        envFile,
        configFile,
      );

      const content = readFileSync(configFile, "utf-8");
      expect(content).toContain("profile: knowledge");
    });

    it("appends to existing config", () => {
      writeFileSync(envFile, "");
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      addSystem(
        {
          id: "new-sys",
          name: "New System",
          profile: "full",
          agents: ["ibmi-db-explorer"],
          host: "new.ibmi.com",
          port: "8076",
          user: "USER2",
          pass: "pass2",
        },
        envFile,
        configFile,
      );

      expect(systemCount(configFile)).toBe(2);
    });

    it("converts id with hyphens to uppercase env keys", () => {
      writeFileSync(envFile, "");
      addSystem(
        {
          id: "my-system",
          name: "My System",
          profile: "full",
          agents: [],
          host: "host",
          port: "8076",
          user: "user",
          pass: "pass",
        },
        envFile,
        configFile,
      );

      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).toContain("SYSTEM_MY_SYSTEM_HOST='host'");
    });
  });

  describe("removeSystem", () => {
    it("removes a system from config", () => {
      writeFileSync(
        envFile,
        "SYSTEM_DEV_HOST='dev.ibmi.com'\nSYSTEM_DEV_USER='user'\n",
      );
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      removeSystem("dev", envFile, configFile);

      const systems = readSystems(configFile);
      expect(systems).toHaveLength(2);
      expect(systems.map((s) => s.id)).toEqual(["default", "prod"]);
    });

    it("removes credentials from env", () => {
      writeFileSync(
        envFile,
        "SYSTEM_DEV_HOST='h'\nSYSTEM_DEV_USER='u'\nSYSTEM_DEV_PASS='p'\nOTHER='keep'\n",
      );
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      removeSystem("dev", envFile, configFile);

      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).not.toContain("SYSTEM_DEV_");
      expect(envContent).toContain("OTHER='keep'");
    });

    it("throws for missing file", () => {
      expect(() => removeSystem("test", envFile, configFile)).toThrow(
        "No systems configured",
      );
    });

    it("throws for non-existing system", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      expect(() => removeSystem("nonexistent", envFile, configFile)).toThrow(
        "System 'nonexistent' not found",
      );
    });
  });
});
