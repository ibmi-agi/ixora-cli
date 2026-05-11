import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateMultiCompose } from "../../src/lib/templates/multi-compose.js";
import {
  SAMPLE_ENV_WITH_SYSTEM,
  SAMPLE_SYSTEMS_YAML,
  SAMPLE_SYSTEMS_YAML_SINGLE,
} from "../helpers/fixtures.js";

describe("templates", () => {
  let tmpDir: string;
  let envFile: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ixora-tmpl-"));
    envFile = join(tmpDir, ".env");
    configFile = join(tmpDir, "ixora-systems.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateMultiCompose", () => {
    it("generates per-system MCP and API services", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);

      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");
      expect(content).toContain("mcp-dev:");
      expect(content).toContain("api-dev:");
      expect(content).toContain("mcp-prod:");
      expect(content).toContain("api-prod:");
    });

    it("assigns sequential ports starting at 8000", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);

      expect(content).toContain('"8000:8000"');
      expect(content).toContain('"8001:8000"');
      expect(content).toContain('"8002:8000"');
    });

    it("includes shared DB service", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("agentos-db:");
    });

    it("includes UI pointing to first API", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("ui:");
      expect(content).toContain("api-default:");
    });

    it("gates UI service behind the 'full' stack profile", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      // The `profiles: ["full"]` tag is what makes `ixora --profile mcp|cli`
      // skip the UI container when starting/stopping/restarting.
      expect(content).toMatch(/ui:[\s\S]*?profiles: \["full"\]/);
      // Backend services have no `profiles:` field — they're always-on.
      expect(content).toMatch(/agentos-db:[\s\S]*?image:/);
      expect(content).not.toMatch(/agentos-db:[\s\S]*?profiles:[\s\S]*?image:/);
    });

    it("uses system-specific env vars for credentials", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("${SYSTEM_DEV_HOST}");
      expect(content).toContain("${SYSTEM_PROD_HOST}");
    });

    it("includes MCP pool query timeout", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain('MCP_POOL_QUERY_TIMEOUT_MS: "120000"');
    });

    it("includes agent feature flags with .env passthrough + defaults", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      // Opt-out (default true) — user can disable via
      // `ixora config set IXORA_ENABLE_BUILDER false && ixora restart`
      expect(content).toContain(
        "IXORA_ENABLE_BUILDER: ${IXORA_ENABLE_BUILDER:-true}",
      );
      // Opt-in (default false) — user enables via
      // `ixora config set IXORA_ENABLE_EXPERIMENTAL true && ixora restart`
      expect(content).toContain(
        "IXORA_ENABLE_EXPERIMENTAL: ${IXORA_ENABLE_EXPERIMENTAL:-false}",
      );
      // RAG API passthrough — empty default means the api container skips
      // RAG tools unless the user sets RAG_API_URL in ~/.ixora/.env
      expect(content).toContain("RAG_API_URL: ${RAG_API_URL:-}");
      expect(content).toContain("RAG_API_TIMEOUT: ${RAG_API_TIMEOUT:-120}");
      // Per-system creds still resolve via compose interpolation
      expect(content).toContain("DB2i_HOST: ${SYSTEM_DEFAULT_HOST}");
      expect(content).toContain("DB2i_HOST: ${SYSTEM_DEV_HOST}");
      expect(content).toContain("DB2i_HOST: ${SYSTEM_PROD_HOST}");
    });

    it("includes user_tools bind mount", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("source: ${HOME}/.ixora/user_tools");
      expect(content).toContain("target: /data/user_tools");
      expect(content).toContain("create_host_path: true");
    });

    it("includes IXORA_SYSTEM_NAME and IXORA_SYSTEM_ID", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("IXORA_SYSTEM_ID: default");
      expect(content).toContain("IXORA_SYSTEM_NAME: myibmi.example.com");
      expect(content).toContain("IXORA_SYSTEM_ID: dev");
      expect(content).toContain("IXORA_SYSTEM_NAME: Development");
    });

    it("uses per-system profile for deployment config", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("app/config/deployments/full.yaml");
      expect(content).toContain("app/config/deployments/security.yaml");
    });

    it("works with a single system in YAML", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("mcp-default:");
      expect(content).toContain("api-default:");
      expect(content).toContain("ui:");
      expect(content).toContain('"8000:8000"');
      expect(content).not.toContain('"8001:8000"');
    });

    it("uses NEXT_PUBLIC_BACKEND_URL pointing at the API base port (default 8000)", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain(
        "NEXT_PUBLIC_BACKEND_URL: http://localhost:8000",
      );
      expect(content).not.toContain("NEXT_PUBLIC_API_URL");
    });

    it("respects IXORA_API_PORT for host port mapping and UI backend URL", () => {
      writeFileSync(
        envFile,
        SAMPLE_ENV_WITH_SYSTEM + "IXORA_API_PORT='9000'\n",
      );
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML_SINGLE);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain('"9000:8000"');
      expect(content).not.toContain('"8000:8000"');
      expect(content).toContain(
        "NEXT_PUBLIC_BACKEND_URL: http://localhost:9000",
      );
    });

    it("preserves per-system stride above the configured base", () => {
      writeFileSync(
        envFile,
        SAMPLE_ENV_WITH_SYSTEM + "IXORA_API_PORT='9000'\n",
      );
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain('"9000:8000"');
      expect(content).toContain('"9001:8000"');
      expect(content).toContain('"9002:8000"');
    });
  });

  describe("generateMultiCompose (per-system DB isolation)", () => {
    const PER_SYSTEM_ENV =
      SAMPLE_ENV_WITH_SYSTEM + "IXORA_DB_ISOLATION='per-system'\n";

    function dependsOnBlock(content: string, id: string): string {
      const block = content.slice(content.indexOf(`  api-${id}:`));
      return block.slice(
        block.indexOf("depends_on:"),
        block.indexOf("healthcheck:"),
      );
    }

    it("emits a one-shot db-init service that creates a database per system", () => {
      writeFileSync(envFile, PER_SYSTEM_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("  db-init:");
      expect(content).toContain('restart: "no"');
      expect(content).toContain("CREATE DATABASE ai_default");
      expect(content).toContain("CREATE DATABASE ai_dev");
      expect(content).toContain("CREATE DATABASE ai_prod");
      expect(content).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    });

    it("points each api at its own ai_<id> database", () => {
      writeFileSync(envFile, PER_SYSTEM_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("DB_DATABASE: ai_default");
      expect(content).toContain("DB_DATABASE: ai_dev");
      expect(content).toContain("DB_DATABASE: ai_prod");
      expect(content).not.toContain("DB_DATABASE: ${DB_DATABASE:-ai}");
    });

    it("gives each api its own data volume and lists them under volumes:", () => {
      writeFileSync(envFile, PER_SYSTEM_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("- agentos-data-default:/data");
      expect(content).toContain("- agentos-data-dev:/data");
      expect(content).not.toContain("- agentos-data:/data");
      expect(content).toMatch(
        /volumes:\n {2}pgdata:\n {2}agentos-data-default:\n {2}agentos-data-dev:\n {2}agentos-data-prod:\n/,
      );
    });

    it("makes each api wait on db-init completing", () => {
      writeFileSync(envFile, PER_SYSTEM_ENV);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      const deps = dependsOnBlock(content, "default");
      expect(deps).toContain("agentos-db:");
      expect(deps).toContain("db-init:");
      expect(deps).toContain("service_completed_successfully");
      // MCP dep is still there in the default (non-CLI) profile.
      expect(deps).toContain("mcp-default:");
    });

    it("sanitizes system ids into valid Postgres identifiers", () => {
      writeFileSync(envFile, PER_SYSTEM_ENV);
      writeFileSync(
        configFile,
        "systems:\n  - id: my-Prod.01\n    name: 'Weird'\n    profile: full\n    agents: []\n",
      );

      const content = generateMultiCompose(envFile, configFile);
      expect(content).toContain("CREATE DATABASE ai_my_prod_01");
      expect(content).toContain("DB_DATABASE: ai_my_prod_01");
    });

    it("leaves the shared-DB layout untouched when unset", () => {
      writeFileSync(envFile, SAMPLE_ENV_WITH_SYSTEM);
      writeFileSync(configFile, SAMPLE_SYSTEMS_YAML);

      const content = generateMultiCompose(envFile, configFile);
      expect(content).not.toContain("db-init:");
      expect(content).toContain("DB_DATABASE: ${DB_DATABASE:-ai}");
      expect(content).toContain("- agentos-data:/data");
      expect(content).toMatch(/volumes:\n {2}pgdata:\n {2}agentos-data:\n/);
    });
  });
});
