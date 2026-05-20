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
  /** The id the user passed (echoed back so they can spot typos quickly). */
  identifier?: string;
  /**
   * Suggested command for discovering valid identifiers, e.g.
   * `ixora agents list`. Appended to NotFoundError messages.
   */
  listCommand?: string;
  /**
   * True when --url was overridden at the command line. Used to switch the
   * connection-error hint away from `ixora stack status` (which only checks
   * configured systems, not arbitrary URLs).
   */
  viaOverrideUrl?: boolean;
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
          // d.loc is typically ["body", "<field>", ...]. When the error is on
          // the body as a whole (loc=["body"]), slice(1).join(".") collapses
          // to "" — which would render as a bare "- : ..." line. Fall back
          // through `raw -> first loc element -> "request body"` so we never
          // emit an empty field name.
          const raw = d.loc?.slice(1).join(".") ?? "";
          const field = raw || d.loc?.[0] || "request body";
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
 * Render a NotFoundError message that echoes the bad id and suggests a
 * discovery command when the call site provides one. Falls back to the
 * pre-existing terse form when no context is supplied so legacy call sites
 * keep working until they're updated.
 */
function formatNotFound(ctx?: ErrorContext): string {
  const what = ctx?.resource ?? "Resource";
  const id = ctx?.identifier;
  const head = id ? `${what} '${id}' not found.` : `${what} not found.`;
  if (!ctx?.listCommand) return head;
  return `${head} Run \`${ctx.listCommand}\` to see available IDs.`;
}

/**
 * Switch the connection-error hint based on whether the user passed --url.
 * `ixora stack status` only diagnoses managed systems, so it's misleading
 * when the user is pointing at an arbitrary URL.
 */
function formatConnectionError(ctx?: ErrorContext): string {
  const target = ctx?.url ? ` to ${ctx.url}` : "";
  if (ctx?.viaOverrideUrl && ctx?.url) {
    return `Cannot connect${target} -- verify the URL is reachable (e.g. \`curl ${ctx.url}/health\`).`;
  }
  return `Cannot connect${target} -- is the system running? Try \`ixora stack status\`.`;
}

/**
 * Recover the real HTTP status from server-side error messages of the
 * form "404: <detail>" or "400: <detail>" that the AgentOS backend wraps
 * in a 500 response. Returns null when the prefix is absent so callers
 * fall back to the generic InternalServerError handling.
 */
function reclassifyInternalServerError(
  err: InternalServerError,
  ctx?: ErrorContext,
): { message: string; exitCode: number } | null {
  const match = /^(\d{3}):\s*(.*)$/s.exec(err.message);
  if (!match) return null;
  const status = Number.parseInt(match[1] ?? "", 10);
  const detail = (match[2] ?? "").trim();
  if (!detail) return null;
  if (status === 404) {
    // Prefer the detail from the server, but layer on the listCommand
    // breadcrumb the call site provided.
    const hint = ctx?.listCommand
      ? ` Run \`${ctx.listCommand}\` to see available IDs.`
      : "";
    return { message: `${detail}.${hint}`, exitCode: 1 };
  }
  if (status >= 400 && status < 500) {
    return { message: detail, exitCode: 1 };
  }
  return null;
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
    writeErr(formatNotFound(ctx));
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
    // The AgentOS backend frequently dresses 4xx errors as 500s with bodies
    // like "404: No database found with id 'x'" or "400: Invalid start_time".
    // Recover the real status from the prefix so exit codes and hints match.
    const reclassified = reclassifyInternalServerError(err, ctx);
    if (reclassified) {
      writeErr(reclassified.message);
      process.exitCode = reclassified.exitCode;
    } else {
      writeErr(
        `Server error: ${err.message}\nRun \`ixora stack status\` for diagnostics.`,
      );
      process.exitCode = 2;
    }
  } else if (err instanceof RemoteServerUnavailableError) {
    writeErr("Server unavailable. Is the system running? `ixora stack status`");
    process.exitCode = 2;
  } else if (isConnectionError(err) || isNetworkAPIError(err)) {
    writeErr(formatConnectionError(ctx));
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
