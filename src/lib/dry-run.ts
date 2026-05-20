import type { Command } from "commander";
import { printJson } from "./agentos-output.js";

/**
 * True when --dry-run was passed on the command line (anywhere in the
 * ancestor chain — it's a global root flag). State-changing commands check
 * this to short-circuit before calling the SDK.
 */
export function isDryRun(cmd: Command): boolean {
  return Boolean(cmd.optsWithGlobals().dryRun);
}

/**
 * Emit a structured description of the action that would have run. Always
 * JSON regardless of -o/--json so agents and scripts get a single, stable
 * shape they can parse without sniffing the output format.
 */
export function emitDryRunPlan(plan: {
  action: string;
  target?: string;
  payload?: Record<string, unknown>;
}): void {
  printJson({ dry_run: true, ...plan });
}
