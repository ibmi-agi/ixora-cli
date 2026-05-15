import chalk from "chalk";
import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import { getOutputFormat, printJson } from "../lib/agentos-output.js";
import { getAgentOSContext } from "../lib/agentos-context.js";

interface HealthSummary {
  ok: boolean;
  status: string;
  url: string;
  system_id?: string;
  instantiated_at: string;
  uptime_seconds: number;
  latency_ms: number;
}

export const healthCommand = new Command("health")
  .description(
    "Ping the AgentOS /health endpoint of the resolved system and report status + uptime + latency",
  )
  .action(async (_options, cmd) => {
    const client = getClient(cmd);
    const url = getBaseUrl(cmd);
    const systemId = getAgentOSContext().systemId;

    const startedAt = Date.now();
    try {
      // SDK type lags the API: server returns
      // { status: "ok", instantiated_at: ISO8601 } per /health in
      // openapi.json. Cast through unknown to the actual wire shape.
      const res = (await client.health()) as unknown as {
        status: string;
        instantiated_at: string;
      };
      const latencyMs = Date.now() - startedAt;
      const instantiatedAt = String(res.instantiated_at ?? "");
      const status = String(res.status ?? "");
      const summary: HealthSummary = {
        ok: status === "ok",
        status,
        url,
        system_id: systemId,
        instantiated_at: instantiatedAt,
        uptime_seconds: uptimeSeconds(instantiatedAt),
        latency_ms: latencyMs,
      };

      if (getOutputFormat(cmd) === "json") {
        printJson(summary);
      } else {
        renderHealth(summary);
      }

      if (!summary.ok) process.exit(1);
    } catch (err) {
      handleError(err, { url });
    }
  });

function uptimeSeconds(instantiatedAt: string): number {
  const t = Date.parse(instantiatedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function renderHealth(s: HealthSummary): void {
  const mark = s.ok ? chalk.green("✓") : chalk.red("✗");
  const targetLabel = s.system_id
    ? `${chalk.bold(s.system_id)} ${chalk.dim(`(${s.url})`)}`
    : chalk.bold(s.url);
  process.stdout.write(`\n${mark} ${targetLabel}\n`);
  process.stdout.write(
    `  ${chalk.dim("status:  ")}${s.ok ? chalk.green(s.status) : chalk.red(s.status)}\n`,
  );
  process.stdout.write(
    `  ${chalk.dim("uptime:  ")}${formatUptime(s.uptime_seconds)} ${chalk.dim(`(since ${s.instantiated_at})`)}\n`,
  );
  process.stdout.write(`  ${chalk.dim("latency: ")}${s.latency_ms}ms\n\n`);
}
