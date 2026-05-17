import type { Command } from "commander";
import chalk from "chalk";

/**
 * Stack-management command names that live under `ixora stack`. If a user
 * types the bare name (`ixora restart`) we hint them at `ixora stack restart`
 * rather than letting commander dump "error: unknown command 'restart'".
 *
 * Only names without an existing top-level equivalent are shimmed — `status`,
 * `agents`, `components`, and `models` exist at both levels and the top-level
 * versions point at AgentOS, which is what a fresh user is more likely to want.
 */
export const STACK_HINT_NAMES = [
  "install",
  "start",
  "stop",
  "restart",
  "upgrade",
  "uninstall",
  "logs",
  "config",
  "system",
  "version",
] as const;

export function isStackHintName(name: string): boolean {
  return (STACK_HINT_NAMES as readonly string[]).includes(name);
}

function printStackHint(name: string): never {
  console.error(
    `${chalk.yellow("Hint:")} stack commands live under ${chalk.bold("ixora stack")}.`,
  );
  console.error(`  Try: ${chalk.bold(`ixora stack ${name}`)}`);
  console.error(`  See: ${chalk.bold("ixora stack --help")}`);
  process.exit(1);
}

export function registerStackHints(program: Command): void {
  for (const name of STACK_HINT_NAMES) {
    program
      .command(name, { hidden: true })
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .argument("[args...]", "any args (ignored — see hint)")
      .action(() => printStackHint(name));
  }
}
