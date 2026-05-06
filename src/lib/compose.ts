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
  // Strip "ixora-" prefix and trailing "-N" replica suffix if present
  return input.replace(/^ixora-/, "").replace(/-\d+$/, "");
}
