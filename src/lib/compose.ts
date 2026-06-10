import { execa, type Options as ExecaOptions } from "execa";
import { existsSync, mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { COMPOSE_FILE, ENV_FILE, IXORA_DIR } from "./constants.js";
import type { StackProfile } from "./constants.js";
import { type ComposeCmd, getComposeParts } from "./platform.js";
import { generateMultiCompose } from "./templates/multi-compose.js";
import { error, bold } from "./ui.js";

interface RunComposeOptions extends ExecaOptions {
  throwOnError?: boolean;
  profile?: StackProfile;
}

function buildComposeArgv(
  composeCmd: ComposeCmd,
  args: string[],
  profile?: StackProfile,
): { bin: string; argv: string[] } {
  const [bin, subArgs] = getComposeParts(composeCmd);
  const argv = [
    ...subArgs,
    "-p",
    "ixora",
    "-f",
    COMPOSE_FILE,
    "--env-file",
    ENV_FILE,
    ...(profile ? ["--profile", profile] : []),
    ...args,
  ];
  return { bin, argv };
}

export async function runCompose(
  composeCmd: ComposeCmd,
  args: string[],
  options: RunComposeOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { throwOnError, profile, ...execaOpts } = options;
  const { bin, argv } = buildComposeArgv(composeCmd, args, profile);

  try {
    const result = await execa(bin, argv, {
      stdio: "inherit",
      ...execaOpts,
    });
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      exitCode: result.exitCode ?? 0,
    };
  } catch (err: unknown) {
    const exitCode =
      err && typeof err === "object" && "exitCode" in err
        ? (err as { exitCode: number }).exitCode
        : 1;

    if (throwOnError) {
      throw new Error(
        `Compose command failed (exit ${exitCode}): ${args.join(" ")}`,
      );
    }

    error(`Command failed: ${composeCmd} ${args.join(" ")}`);
    console.log(`  Check ${bold("ixora logs")} for details.`);
    process.exit(exitCode);
  }
}

export async function runComposeCapture(
  composeCmd: ComposeCmd,
  args: string[],
  options: { profile?: StackProfile } = {},
): Promise<string> {
  const { bin, argv } = buildComposeArgv(composeCmd, args, options.profile);
  const result = await execa(bin, argv, { stdio: "pipe" });
  return result.stdout;
}

export function writeComposeFile(envFile: string = ENV_FILE): void {
  mkdirSync(IXORA_DIR, { recursive: true });
  const content = generateMultiCompose(envFile);
  writeFileSync(COMPOSE_FILE, content, "utf-8");
}

export function requireInstalled(): void {
  if (!existsSync(ENV_FILE)) {
    throw new Error("ixora is not installed. Run: ixora install");
  }
}

export function requireComposeFile(): void {
  if (!existsSync(COMPOSE_FILE)) {
    throw new Error("ixora is not installed. Run: ixora install");
  }
}

export function resolveService(input: string): string {
  // Strip "ixora-" prefix and trailing "-N" replica suffix if present.
  // docker compose v2 separates with dashes (ixora-api-1); podman-compose
  // uses underscores (ixora_api_1) — accept both.
  return input.replace(/^ixora[-_]/, "").replace(/[-_]\d+$/, "");
}

/**
 * One normalized entry from `compose ps --format json`.
 *
 * Docker Compose v2 emits NDJSON (or, in older versions, a JSON array) with
 * top-level `Service` and `Name` keys. podman-compose delegates to
 * `podman ps`, whose JSON array entries have neither — the service is only
 * in Labels["com.docker.compose.service"] and the container name in the
 * `Names` array. parseComposePs normalizes both dialects to this shape.
 */
export interface ComposePsEntry {
  Service?: string;
  State?: string;
  Name?: string;
}

interface RawPsEntry {
  Service?: string;
  State?: string;
  Name?: string;
  Names?: string[] | string;
  Labels?: Record<string, string> | string;
}

const SERVICE_LABEL = "com.docker.compose.service";

export function parseComposePs(output: string): ComposePsEntry[] {
  return parseJsonEntries<RawPsEntry>(output).map((entry) => ({
    Service: entry.Service ?? serviceFromLabels(entry.Labels),
    State: entry.State,
    Name:
      entry.Name ?? (Array.isArray(entry.Names) ? entry.Names[0] : entry.Names),
  }));
}

function serviceFromLabels(
  labels: RawPsEntry["Labels"],
): string | undefined {
  if (!labels) return undefined;
  if (typeof labels === "string") {
    // docker-style "key=value,key=value" label string
    for (const pair of labels.split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0 && pair.slice(0, eq) === SERVICE_LABEL) {
        return pair.slice(eq + 1);
      }
    }
    return undefined;
  }
  return labels[SERVICE_LABEL];
}

/** One entry from `compose images --format json` (docker compose v2 schema). */
export interface ComposeImage {
  Service?: string;
  Repository?: string;
  Tag?: string;
  ID?: string;
  Size?: number;
}

export function parseComposeImages(output: string): ComposeImage[] {
  return parseJsonEntries<ComposeImage>(output);
}

/** Parse a JSON array, single JSON object, or NDJSON lines. */
function parseJsonEntries<T>(output: string): T[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed as T[];
    return [parsed as T];
  } catch {
    return trimmed
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((x): x is T => x !== null);
  }
}
