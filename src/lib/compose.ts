import { execa, type Options as ExecaOptions } from "execa";
import { existsSync, mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import {
  COMPOSE_FILE,
  ENV_FILE,
  IXORA_DIR,
} from "./constants.js";
import { type ComposeCmd, getComposeParts } from "./platform.js";
import { envGet } from "./env.js";
import { totalSystemCount } from "./systems.js";
import { generateSingleCompose } from "./templates/single-compose.js";
import { generateMultiCompose } from "./templates/multi-compose.js";
import { error, bold } from "./ui.js";

export async function runCompose(
  composeCmd: ComposeCmd,
  args: string[],
  options: ExecaOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const [bin, subArgs] = getComposeParts(composeCmd);
  const fullArgs = [
    ...subArgs,
    "-p",
    "ixora",
    "-f",
    COMPOSE_FILE,
    "--env-file",
    ENV_FILE,
    ...args,
  ];

  try {
    const result = await execa(bin, fullArgs, {
      stdio: "inherit",
      ...options,
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
    error(`Command failed: ${composeCmd} ${args.join(" ")}`);
    console.log(`  Check ${bold("ixora-cli logs")} for details.`);
    process.exit(exitCode);
  }
}

export async function runComposeCapture(
  composeCmd: ComposeCmd,
  args: string[],
): Promise<string> {
  const [bin, subArgs] = getComposeParts(composeCmd);
  const fullArgs = [
    ...subArgs,
    "-p",
    "ixora",
    "-f",
    COMPOSE_FILE,
    "--env-file",
    ENV_FILE,
    ...args,
  ];

  const result = await execa(bin, fullArgs, { stdio: "pipe" });
  return result.stdout;
}

export function writeComposeFile(envFile: string = ENV_FILE): void {
  mkdirSync(IXORA_DIR, { recursive: true });

  const total = totalSystemCount(envFile);

  let content: string;
  if (total > 1) {
    content = generateMultiCompose(envFile);
  } else {
    content = generateSingleCompose();
  }

  writeFileSync(COMPOSE_FILE, content, "utf-8");
}

export function requireInstalled(): void {
  if (!existsSync(ENV_FILE)) {
    throw new Error("ixora is not installed. Run: ixora-cli install");
  }
}

export function requireComposeFile(): void {
  if (!existsSync(COMPOSE_FILE)) {
    throw new Error("ixora is not installed. Run: ixora-cli install");
  }
}

export function resolveService(input: string): string {
  // Strip "ixora-" prefix and trailing "-N" replica suffix if present
  return input.replace(/^ixora-/, "").replace(/-\d+$/, "");
}
