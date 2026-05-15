// Resolve which local AgentOS endpoint an agno-mounted command should target.
//
// Flow:
//   1. --url override → bypass system resolution entirely (escape hatch)
//   2. Read configured systems from ixora-systems.yaml
//   3. Discover running api-<id> containers via `docker compose ps`
//   4. Apply --system flag, or pick the single running system implicitly
//   5. Compute port = IXORA_API_PORT base + index-in-systems.yaml
//   6. Read SYSTEM_<ID>_AGENTOS_KEY from .env (empty/absent → unauthenticated)

import chalk from "chalk";
import { existsSync } from "node:fs";
import { runComposeCapture } from "./compose.js";
import { COMPOSE_FILE } from "./constants.js";
import { envGet, getApiPortBase } from "./env.js";
import { detectComposeCmd } from "./platform.js";
import { readSystems } from "./systems.js";
import type { ResolvedAgentOSContext } from "./agentos-context.js";

export interface ResolverFlags {
  /** --system / -s: explicit target name */
  system?: string;
  /** --url: bypass system resolution and talk to this endpoint */
  url?: string;
  /** --key: per-invocation auth override */
  key?: string;
  /** --timeout: per-invocation timeout override (seconds) */
  timeout?: number;
}

const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * Discover which `api-<id>` services are running.
 *
 * Mirrors the parsing approach in commands/status.ts (both NDJSON and JSON-array
 * outputs from `docker compose ps --format json`). Returns an empty set when
 * the stack hasn't been installed yet or the compose call fails.
 */
export async function discoverRunningSystems(): Promise<Set<string>> {
  if (!existsSync(COMPOSE_FILE)) return new Set();

  let psJson: string;
  try {
    const composeCmd = await detectComposeCmd();
    psJson = await runComposeCapture(composeCmd, ["ps", "--format", "json"]);
  } catch {
    return new Set();
  }

  const trimmed = psJson.trim();
  if (!trimmed) return new Set();

  const entries = parseComposePs(trimmed);
  const running = new Set<string>();
  for (const entry of entries) {
    if (entry.State !== "running" || !entry.Service) continue;
    const m = /^api-(.+)$/.exec(entry.Service);
    if (m) running.add(m[1]);
  }
  return running;
}

interface ComposePsEntry {
  Service?: string;
  State?: string;
}

function parseComposePs(output: string): ComposePsEntry[] {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed as ComposePsEntry[];
    return [parsed as ComposePsEntry];
  } catch {
    return output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as ComposePsEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is ComposePsEntry => x !== null);
  }
}

/**
 * Resolve the AgentOS target for a single CLI invocation.
 *
 * Exits the process with a clear error message when no valid target can be
 * determined. Returns the resolved context on success.
 */
export async function resolveAgentOSTarget(
  flags: ResolverFlags,
): Promise<ResolvedAgentOSContext> {
  const timeout = flags.timeout ?? DEFAULT_TIMEOUT_SECONDS;

  // 1. --url is an explicit endpoint override. Skip every system check.
  if (flags.url) {
    return {
      baseUrl: flags.url,
      securityKey: flags.key && flags.key.length > 0 ? flags.key : undefined,
      timeout,
      systemId: undefined,
    };
  }

  // 2. Configured systems
  const systems = readSystems();
  if (systems.length === 0) {
    fail(
      "No systems configured. Add one with `ixora stack system add` (or `ixora stack install` for first-time setup).",
    );
  }

  // 3. Running set
  const running = await discoverRunningSystems();

  // 4. Pick a target
  let targetIndex: number;
  if (flags.system) {
    const idx = systems.findIndex((s) => s.id === flags.system);
    if (idx === -1) {
      fail(
        `No such system '${flags.system}'. Configured: ${systems.map((s) => s.id).join(", ")}`,
      );
    }
    if (!running.has(flags.system)) {
      fail(
        `System '${flags.system}' is not running. Start it with: ixora stack system start ${flags.system}`,
      );
    }
    targetIndex = idx;
  } else {
    if (running.size === 0) {
      fail(
        `No systems are running. Start one with: ixora stack system start <id>\nConfigured: ${systems.map((s) => s.id).join(", ")}`,
      );
    }

    let chosenId: string;
    if (running.size === 1) {
      chosenId = Array.from(running)[0]!;
    } else {
      // 2+ running — fall back to the configured default system if it's
      // set and the named system is currently running. Otherwise require
      // the user to disambiguate with --system.
      const defaultId = envGet("IXORA_DEFAULT_SYSTEM");
      if (defaultId && defaultId.length > 0 && running.has(defaultId)) {
        chosenId = defaultId;
      } else {
        const runningList = Array.from(running).sort().join(", ");
        const hint =
          defaultId && defaultId.length > 0
            ? `\nDefault system '${defaultId}' is configured but not in the running set.`
            : `\nTip: configure a default with \`ixora stack system default <id>\`.`;
        fail(
          `Multiple systems are running. Specify --system <name>.${hint}\nRunning: ${runningList}`,
        );
      }
    }

    targetIndex = systems.findIndex((s) => s.id === chosenId);
    if (targetIndex === -1) {
      fail(
        `Running container references system '${chosenId}' which is not in ixora-systems.yaml. Re-run \`ixora stack install\`.`,
      );
    }
  }

  const target = systems[targetIndex];
  if (!target) {
    fail("Internal error: target system index out of range.");
  }

  // 5. Compute port from index, mirroring lib/templates/multi-compose.ts
  const baseUrl = `http://localhost:${getApiPortBase() + targetIndex}`;

  // 6. Per-system auth key (empty string → undefined)
  const idUpper = target.id.toUpperCase().replace(/-/g, "_");
  const envKey = envGet(`SYSTEM_${idUpper}_AGENTOS_KEY`);
  const flagKey = flags.key;
  const securityKey =
    flagKey && flagKey.length > 0
      ? flagKey
      : envKey && envKey.length > 0
        ? envKey
        : undefined;

  return {
    baseUrl,
    securityKey,
    timeout,
    systemId: target.id,
  };
}

function fail(msg: string): never {
  process.stderr.write(`${chalk.red("Error:")} ${msg}\n`);
  process.exit(1);
}
