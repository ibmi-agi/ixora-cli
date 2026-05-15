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
  getManagedSystems,
  indexAmongManaged,
} from "../../src/lib/systems.js";
import {
  SAMPLE_SYSTEMS_YAML,
  SAMPLE_SYSTEMS_YAML_SINGLE,
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

    it("parses pre-kind YAMLs as managed (back-compat)", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);
      const systems = readSystems(configFile);

      expect(systems).toHaveLength(3);
      expect(systems[0]).toEqual({
        id: "default",
        name: "myibmi.example.com",
        kind: "managed",
        mode: "full",
      });
      expect(systems[1]).toEqual({
        id: "dev",
        name: "Development",
        kind: "managed",
        mode: "custom",
      });
      expect(systems[2]).toEqual({
        id: "prod",
        name: "Production",
        kind: "managed",
        mode: "full",
      });
    });

    it("parses single system", () => {
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);
      const systems = readSystems(configFile);

      expect(systems).toHaveLength(1);
      expect(systems[0].id).toBe("default");
      expect(systems[0].name).toBe("myibmi.example.com");
      expect(systems[0].kind).toBe("managed");
      if (systems[0].kind === "managed") {
        expect(systems[0].mode).toBe("full");
      }
    });

    it("parses external entries with url", () => {
      writeFileSync(
        configFile,
        `systems:
  - id: prod1
    name: 'Production'
    kind: managed
    mode: full
  - id: personal
    name: 'Personal AgentOS'
    kind: external
    url: 'http://localhost:8080'
  - id: cloud
    name: 'Cloud AgentOS'
    kind: external
    url: 'https://agentos.example.com'
`,
      );
      const systems = readSystems(configFile);

      expect(systems).toHaveLength(3);
      expect(systems[1]).toEqual({
        id: "personal",
        name: "Personal AgentOS",
        kind: "external",
        url: "http://localhost:8080",
      });
      expect(systems[2]).toEqual({
        id: "cloud",
        name: "Cloud AgentOS",
        kind: "external",
        url: "https://agentos.example.com",
      });
    });

    it("skips malformed external entries (no url)", () => {
      writeFileSync(
        configFile,
        `systems:
  - id: prod1
    name: 'Production'
    kind: managed
    mode: full
  - id: broken
    name: 'External Without URL'
    kind: external
  - id: ok
    name: 'OK'
    kind: managed
    mode: full
`,
      );
      const systems = readSystems(configFile);
      expect(systems.map((s) => s.id)).toEqual(["prod1", "ok"]);
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

  describe("getManagedSystems / indexAmongManaged", () => {
    it("filters to managed and indexes managed-only", () => {
      writeFileSync(
        configFile,
        `systems:
  - id: prod1
    name: 'P'
    kind: managed
    mode: full
  - id: personal
    name: 'X'
    kind: external
    url: 'http://localhost:8080'
  - id: sandbox
    name: 'S'
    kind: managed
    mode: custom
  - id: cloud
    name: 'C'
    kind: external
    url: 'https://x'
`,
      );
      const systems = readSystems(configFile);
      const managed = getManagedSystems(systems);

      expect(managed.map((s) => s.id)).toEqual(["prod1", "sandbox"]);
      // External entries do not consume port slots — sandbox is still index 1.
      expect(indexAmongManaged(systems, systems[2])).toBe(1);
      // External entries return -1 (no port slot).
      expect(indexAmongManaged(systems, systems[1])).toBe(-1);
    });
  });

  describe("addSystem (managed)", () => {
    it("creates new config file with first system and writes kind: managed", () => {
      writeFileSync(envFile, "");
      addSystem(
        {
          id: "test",
          name: "Test System",
          mode: "custom",
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
      expect(systems[0].kind).toBe("managed");
      if (systems[0].kind === "managed") {
        expect(systems[0].mode).toBe("custom");
      }

      const yaml = readFileSync(configFile, "utf-8");
      expect(yaml).toContain("kind: managed");
      expect(yaml).toContain("mode: custom");

      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).toContain("SYSTEM_TEST_HOST='test.ibmi.com'");
      expect(envContent).toContain("SYSTEM_TEST_USER='TESTUSER'");
    });

    it("appends to existing config", () => {
      writeFileSync(envFile, "");
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      addSystem(
        {
          id: "new-sys",
          name: "New System",
          mode: "full",
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
          mode: "full",
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

  describe("addSystem (external)", () => {
    it("writes kind: external + url, no IBM i creds", () => {
      writeFileSync(envFile, "");
      addSystem(
        {
          id: "personal",
          name: "Personal AgentOS",
          kind: "external",
          url: "http://localhost:8080",
        },
        envFile,
        configFile,
      );

      const systems = readSystems(configFile);
      expect(systems).toHaveLength(1);
      expect(systems[0]).toEqual({
        id: "personal",
        name: "Personal AgentOS",
        kind: "external",
        url: "http://localhost:8080",
      });

      const yaml = readFileSync(configFile, "utf-8");
      expect(yaml).toContain("kind: external");
      expect(yaml).toContain("url: 'http://localhost:8080'");
      expect(yaml).not.toContain("mode:");

      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).not.toContain("SYSTEM_PERSONAL_HOST");
      expect(envContent).not.toContain("SYSTEM_PERSONAL_USER");
    });

    it("stores optional API key in .env when provided", () => {
      writeFileSync(envFile, "");
      addSystem(
        {
          id: "cloud",
          name: "Cloud",
          kind: "external",
          url: "https://agentos.example.com",
          key: "sk-secret-123",
        },
        envFile,
        configFile,
      );

      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).toContain("SYSTEM_CLOUD_AGENTOS_KEY='sk-secret-123'");
    });
  });

  describe("removeSystem", () => {
    it("removes a managed system from config", () => {
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

    it("removes an external system and its AGENTOS_KEY", () => {
      writeFileSync(envFile, "SYSTEM_CLOUD_AGENTOS_KEY='sk-x'\nOTHER='keep'\n");
      writeFileSync(
        configFile,
        `systems:
  - id: cloud
    name: 'Cloud'
    kind: external
    url: 'https://x'
`,
      );

      removeSystem("cloud", envFile, configFile);

      expect(readSystems(configFile)).toHaveLength(0);
      const envContent = readFileSync(envFile, "utf-8");
      expect(envContent).not.toContain("SYSTEM_CLOUD_");
      expect(envContent).toContain("OTHER='keep'");
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
