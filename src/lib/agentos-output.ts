import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

// Output helpers ported from agno-cli/src/lib/output.ts.
// Behaviour kept identical so command files port over with minimal change.

/**
 * Determine output format from command options or TTY detection.
 * Returns "json" when explicitly requested, when --json flag is used, or when stdout is not a TTY (piped).
 * Returns "table" when explicitly requested or when stdout is a TTY (interactive).
 */
export function getOutputFormat(cmd: Command): "table" | "json" {
  const globals = cmd.optsWithGlobals();
  if (globals.json !== undefined) return "json";
  if (globals.output === "json") return "json";
  if (globals.output === "table") return "table";
  return process.stdout.isTTY ? "table" : "json";
}

/**
 * Get field selection from --json flag if present.
 */
export function getJsonFields(cmd: Command): string | undefined {
  const globals = cmd.optsWithGlobals();
  if (typeof globals.json === "string") return globals.json;
  return undefined;
}

/**
 * Select specific fields from a data object or array of objects.
 */
export function selectFields(
  data: Record<string, unknown> | Record<string, unknown>[],
  fields: string,
): unknown {
  const fieldList = fields.split(",").map((f) => f.trim());
  if (Array.isArray(data)) {
    return data.map((item) => pickFields(item, fieldList));
  }
  return pickFields(data, fieldList);
}

function pickFields(
  obj: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in obj) {
      result[field] = obj[field];
    }
  }
  return result;
}

/**
 * Render a list of records as either a JSON array or a cli-table3 table.
 */
export function outputList(
  cmd: Command,
  data: Record<string, unknown>[],
  opts: {
    columns: string[];
    keys: string[];
    meta?: {
      page: number;
      limit: number;
      total_pages: number;
      total_count: number;
    };
  },
): void {
  const format = getOutputFormat(cmd);
  if (format === "json") {
    const fields = getJsonFields(cmd);
    if (fields) {
      const filtered = selectFields(data, fields);
      process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
      return;
    }
    const envelope: Record<string, unknown> = { data };
    if (opts.meta) envelope.meta = opts.meta;
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  if (data.length === 0) {
    process.stderr.write("No items found.\n");
    return;
  }

  const colWidths = calculateColWidths(opts.columns.length);
  const table = new Table({
    head: opts.columns.map((c) => chalk.bold(c)),
    style: { head: [], border: [] },
    ...(colWidths ? { colWidths } : {}),
  });

  for (const row of data) {
    table.push(opts.keys.map((key) => String(row[key] ?? "")));
  }

  process.stdout.write(`${table.toString()}\n`);
}

/**
 * Render a single record as either JSON or a key-value table.
 */
export function outputDetail(
  cmd: Command,
  data: Record<string, unknown>,
  opts: { labels: string[]; keys: string[] },
): void {
  const format = getOutputFormat(cmd);
  if (format === "json") {
    const fields = getJsonFields(cmd);
    if (fields) {
      const filtered = selectFields(data, fields);
      process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  const maxLabelLen = Math.max(...opts.labels.map((l) => l.length));
  const lines: string[] = [];
  for (let i = 0; i < opts.labels.length; i++) {
    const label = opts.labels[i];
    const key = opts.keys[i];
    if (label !== undefined && key !== undefined) {
      const padded = `${label}:`.padEnd(maxLabelLen + 2);
      lines.push(`${chalk.bold(padded)} ${String(data[key] ?? "")}`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * Write raw JSON to stdout.
 */
export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function writeError(msg: string): void {
  process.stderr.write(`${chalk.red("Error:")} ${msg}\n`);
}

export function writeSuccess(msg: string): void {
  process.stderr.write(`${chalk.green("Success:")} ${msg}\n`);
}

export function writeWarning(msg: string): void {
  process.stderr.write(`${chalk.yellow("Warning:")} ${msg}\n`);
}

/**
 * Mask an API key for safe display.
 */
export function maskKey(key: string | undefined | null): string {
  if (!key) return "(not set)";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

/**
 * Handle --no-color flag by setting NO_COLOR env var so chalk auto-disables.
 */
export function handleNoColorFlag(cmd: Command): void {
  const globals = cmd.optsWithGlobals();
  if (globals.color === false) {
    process.env.NO_COLOR = "1";
  }
}

function calculateColWidths(numCols: number): number[] | undefined {
  const termWidth = process.stdout.columns;
  if (!termWidth) return undefined;
  const available = termWidth - numCols * 3;
  const colWidth = Math.max(10, Math.floor(available / numCols));
  return Array.from({ length: numCols }, () => colWidth);
}
