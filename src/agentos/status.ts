import chalk from "chalk";
import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  printJson,
} from "../lib/agentos-output.js";

interface DbRef {
  db_id?: string;
}

interface DomainConfig {
  dbs?: DbRef[];
}

interface KnowledgeInstance {
  id?: string;
  name?: string;
  db_id?: string;
  table?: string;
}

interface KnowledgeConfig extends DomainConfig {
  knowledge_instances?: KnowledgeInstance[];
}

interface ResourceSummary {
  id?: string;
  name?: string;
  description?: string;
  db_id?: string;
}

interface TeamSummary extends ResourceSummary {
  mode?: string;
}

interface InterfaceSummary {
  type?: string;
  version?: string;
  route?: string;
}

interface ConfigShape {
  os_id?: string;
  name?: string;
  description?: string;
  os_database?: string;
  databases?: string[];
  session?: DomainConfig;
  metrics?: DomainConfig;
  memory?: DomainConfig;
  knowledge?: KnowledgeConfig;
  evals?: DomainConfig;
  traces?: DomainConfig;
  agents?: ResourceSummary[];
  teams?: TeamSummary[];
  workflows?: ResourceSummary[];
  interfaces?: InterfaceSummary[];
}

export const statusCommand = new Command("status")
  .description("Show AgentOS server status and resource overview")
  .action(async (_options, cmd) => {
    try {
      const client = getClient(cmd);
      const raw = (await client.getConfig()) as unknown as Record<
        string,
        unknown
      >;

      const format = getOutputFormat(cmd);
      if (format === "json") {
        printJson(raw);
        return;
      }

      const config = raw as ConfigShape;
      renderOsIdentity(cmd, config);
      renderDatabases(config);
      renderStorage(cmd, config);
      renderAgents(cmd, config.agents);
      renderTeams(cmd, config.teams);
      renderWorkflows(cmd, config.workflows);
      renderKnowledge(cmd, config.knowledge?.knowledge_instances);
      renderInterfaces(cmd, config.interfaces);
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

function printSection(title: string, count?: number): void {
  const suffix = typeof count === "number" ? ` (${count})` : "";
  process.stdout.write(`\n${chalk.bold.cyan(title + suffix)}\n`);
}

function truncate(value: string | undefined, max = 80): string {
  if (!value) return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

function dbIdsFor(domain: DomainConfig | undefined): string {
  if (!domain?.dbs?.length) return "";
  return domain.dbs
    .map((d) => d.db_id ?? "")
    .filter((id) => id.length > 0)
    .join(", ");
}

function renderOsIdentity(cmd: Command, config: ConfigShape): void {
  const display: Record<string, unknown> = {
    os_id: config.os_id ?? "unknown",
  };
  const labels: string[] = ["OS ID"];
  const keys: string[] = ["os_id"];

  if (config.name) {
    display.name = config.name;
    labels.push("Name");
    keys.push("name");
  }
  if (config.description) {
    display.description = config.description;
    labels.push("Description");
    keys.push("description");
  }

  outputDetail(cmd, display, { labels, keys });
}

function renderDatabases(config: ConfigShape): void {
  const dbs = config.databases ?? [];
  if (dbs.length === 0) return;

  printSection("DATABASES", dbs.length);
  for (const db of dbs) {
    const marker =
      db === config.os_database ? chalk.dim(" (primary)") : "";
    process.stdout.write(`  - ${db}${marker}\n`);
  }
}

function renderStorage(cmd: Command, config: ConfigShape): void {
  const rows: Array<{ label: string; key: string; value: string }> = [
    { label: "Sessions", key: "sessions", value: dbIdsFor(config.session) },
    { label: "Metrics", key: "metrics", value: dbIdsFor(config.metrics) },
    { label: "Memory", key: "memory", value: dbIdsFor(config.memory) },
    { label: "Knowledge", key: "knowledge", value: dbIdsFor(config.knowledge) },
    { label: "Evals", key: "evals", value: dbIdsFor(config.evals) },
    { label: "Traces", key: "traces", value: dbIdsFor(config.traces) },
  ].filter((r) => r.value.length > 0);

  if (rows.length === 0) return;

  printSection("STORAGE");
  const display: Record<string, unknown> = {};
  for (const r of rows) display[r.key] = r.value;
  outputDetail(cmd, display, {
    labels: rows.map((r) => r.label),
    keys: rows.map((r) => r.key),
  });
}

function renderAgents(
  cmd: Command,
  agents: ResourceSummary[] | undefined,
): void {
  if (!agents?.length) return;
  printSection("AGENTS", agents.length);
  outputList(
    cmd,
    agents.map((a) => ({
      id: a.id ?? "",
      name: a.name ?? "",
      db_id: a.db_id ?? "",
      description: truncate(a.description),
    })),
    {
      columns: ["ID", "NAME", "DB", "DESCRIPTION"],
      keys: ["id", "name", "db_id", "description"],
    },
  );
}

function renderTeams(cmd: Command, teams: TeamSummary[] | undefined): void {
  if (!teams?.length) return;
  printSection("TEAMS", teams.length);
  outputList(
    cmd,
    teams.map((t) => ({
      id: t.id ?? "",
      name: t.name ?? "",
      mode: t.mode ?? "",
      db_id: t.db_id ?? "",
      description: truncate(t.description),
    })),
    {
      columns: ["ID", "NAME", "MODE", "DB", "DESCRIPTION"],
      keys: ["id", "name", "mode", "db_id", "description"],
    },
  );
}

function renderWorkflows(
  cmd: Command,
  workflows: ResourceSummary[] | undefined,
): void {
  if (!workflows?.length) return;
  printSection("WORKFLOWS", workflows.length);
  outputList(
    cmd,
    workflows.map((w) => ({
      id: w.id ?? "",
      name: w.name ?? "",
      db_id: w.db_id ?? "",
      description: truncate(w.description),
    })),
    {
      columns: ["ID", "NAME", "DB", "DESCRIPTION"],
      keys: ["id", "name", "db_id", "description"],
    },
  );
}

function renderKnowledge(
  cmd: Command,
  instances: KnowledgeInstance[] | undefined,
): void {
  if (!instances?.length) return;
  printSection("KNOWLEDGE", instances.length);
  outputList(
    cmd,
    instances.map((k) => ({
      id: k.id ?? "",
      name: k.name ?? "",
      db_id: k.db_id ?? "",
      table: k.table ?? "",
    })),
    {
      columns: ["ID", "NAME", "DB", "TABLE"],
      keys: ["id", "name", "db_id", "table"],
    },
  );
}

function renderInterfaces(
  cmd: Command,
  interfaces: InterfaceSummary[] | undefined,
): void {
  if (!interfaces?.length) return;
  printSection("INTERFACES", interfaces.length);
  outputList(
    cmd,
    interfaces.map((i) => ({
      type: i.type ?? "",
      version: i.version ?? "",
      route: i.route ?? "",
    })),
    {
      columns: ["TYPE", "VERSION", "ROUTE"],
      keys: ["type", "version", "route"],
    },
  );
}
