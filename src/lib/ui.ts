import chalk from "chalk";

export function info(message: string): void {
  console.log(`${chalk.blue("==>")} ${chalk.bold(message)}`);
}

export function success(message: string): void {
  console.log(`${chalk.green("==>")} ${chalk.bold(message)}`);
}

export function warn(message: string): void {
  console.log(`${chalk.yellow("Warning:")} ${message}`);
}

export function error(message: string): void {
  console.error(`${chalk.red("Error:")} ${message}`);
}

export function die(message: string): never {
  error(message);
  process.exit(1);
}

export function maskValue(value: string | undefined): string {
  if (!value) return chalk.dim("(not set)");
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}****`;
}

export function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase();
  return /KEY|TOKEN|PASS|SECRET|ENCRYPT/.test(upper);
}

export function dim(message: string): string {
  return chalk.dim(message);
}

export function bold(message: string): string {
  return chalk.bold(message);
}

export function cyan(message: string): string {
  return chalk.cyan(message);
}

export function section(title: string): void {
  console.log(
    `  ${chalk.dim(`── ${title} ${"─".repeat(Math.max(0, 49 - title.length))}`)}`,
  );
}
