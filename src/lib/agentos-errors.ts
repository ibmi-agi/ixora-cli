import {
  APIError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  RateLimitError,
  RemoteServerUnavailableError,
  UnprocessableEntityError,
} from "@worksofadam/agentos-sdk";
import chalk from "chalk";

// Error handling ported from agno-cli/src/lib/errors.ts.
// Diagnostic messages adjusted to point at ixora's CLI surface.

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ErrorContext {
  resource?: string;
  url?: string;
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND")
    return true;
  if (err.message.includes("fetch failed")) return true;
  return false;
}

function isNetworkAPIError(err: unknown): boolean {
  return (
    err instanceof APIError &&
    err.status === 0 &&
    err.message.includes("Network error")
  );
}

function formatValidationError(message: string): string {
  try {
    const parsed = JSON.parse(message);
    if (parsed && Array.isArray(parsed.detail)) {
      const lines = parsed.detail.map(
        (d: { loc?: string[]; msg?: string }) => {
          const field = d.loc?.slice(1).join(".") ?? "unknown";
          return `  - ${field}: ${d.msg ?? "invalid"}`;
        },
      );
      return `Validation error:\n${lines.join("\n")}`;
    }
  } catch {
    /* not JSON */
  }
  return `Validation error: ${message}`;
}

function writeErr(msg: string): void {
  process.stderr.write(`${chalk.red("Error:")} ${msg}\n`);
}

/**
 * Centralised error handler that maps SDK errors to actionable CLI messages.
 * Sets exit codes: 1 for user errors, 2 for system errors.
 */
export function handleError(err: unknown, ctx?: ErrorContext): never {
  if (err instanceof AuthenticationError) {
    writeErr(
      "Authentication failed. Set the system's AgentOS key with `ixora stack system add` (or unset SYSTEM_<ID>_AGENTOS_KEY in ~/.ixora/.env for local unauth).",
    );
    process.exitCode = 1;
  } else if (err instanceof NotFoundError) {
    const what = ctx?.resource ?? "Resource";
    writeErr(`${what} not found.`);
    process.exitCode = 1;
  } else if (err instanceof BadRequestError) {
    writeErr(`Invalid request: ${err.message}`);
    process.exitCode = 1;
  } else if (err instanceof UnprocessableEntityError) {
    writeErr(formatValidationError(err.message));
    process.exitCode = 1;
  } else if (err instanceof RateLimitError) {
    writeErr("Rate limited. Wait and retry.");
    process.exitCode = 2;
  } else if (err instanceof InternalServerError) {
    writeErr(
      `Server error: ${err.message}\nRun \`ixora stack status\` for diagnostics.`,
    );
    process.exitCode = 2;
  } else if (err instanceof RemoteServerUnavailableError) {
    writeErr("Server unavailable. Is the system running? `ixora stack status`");
    process.exitCode = 2;
  } else if (isConnectionError(err) || isNetworkAPIError(err)) {
    const target = ctx?.url ? ` to ${ctx.url}` : "";
    writeErr(
      `Cannot connect${target} -- is the system running? Try \`ixora stack status\`.`,
    );
    process.exitCode = 2;
  } else if (err instanceof APIError && err.status === 403) {
    const isAdmin = err.message.toLowerCase().includes("admin");
    if (isAdmin) {
      writeErr(
        "This operation requires admin scope. Check your AgentOS key permissions.",
      );
    } else {
      writeErr("Access denied. Check your AgentOS key permissions.");
    }
    process.exitCode = 1;
  } else if (err instanceof APIError) {
    writeErr(`API error (${err.status}): ${err.message}`);
    process.exitCode = err.status >= 500 ? 2 : 1;
  } else if (err instanceof ConfigError) {
    writeErr(err.message);
    process.exitCode = 1;
  } else {
    writeErr(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }

  process.exit();
}
