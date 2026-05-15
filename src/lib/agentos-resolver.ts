// Resolve which AgentOS endpoint a runtime command should target.
//
// Systems come in two kinds (see lib/systems.ts):
//   - managed:  an ixora-provisioned docker compose stack on localhost
//   - external: any AgentOS-compatible URL ixora does NOT lifecycle-manage
//
// Available set = (running managed) ∪ (all external).
//
// Flow:
//   1. --url override → bypass system resolution entirely (escape hatch)
//   2. Read configured systems from ixora-systems.yaml
//   3. Discover running api-<id> containers via `docker compose ps`
//   4. Compute the available set; apply --system, IXORA_DEFAULT_SYSTEM, or
//      implicit single-pick against it
//   5. Compute baseUrl:
//        - managed:  http://localhost:<IXORA_API_PORT base + indexAmongManaged>
//        - external: sys.url verbatim
//   6. Read SYSTEM_<ID>_AGENTOS_KEY from .env (works for both kinds)

import chalk from "chalk";
import { existsSync } from "node:fs";
import { runComposeCapture } from "./compose.js";
import { COMPOSE_FILE } from "./constants.js";
import { envGet, getApiPortBase } from "./env.js";
import { detectComposeCmd } from "./platform.js";
import {
  indexAmongManaged,
  readSystems,
  type SystemConfig,
} from "./systems.js";
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
 * Whether `sys` is targetable right now. Managed systems must have a running
 * container; external systems are always considered available (the actual
 * HTTP request is what discovers if the URL is reachable).
 */
function isAvailable(sys: SystemConfig, running: Set<string>): boolean {
  return sys.kind === "external" || running.has(sys.id);
}

/**
 * Resolve the AgentOS target for a single CLI invocation.
 *
 * Exits the process with a clear error message when no valid target can be
 * determined. Returns the resolved context on success.
 *
 * `opts.discoverRunning` is injected for testability; production callers
 * omit it and the live docker-compose discovery is used.
 */
export async function resolveAgentOSTarget(
  flags: ResolverFlags,
  opts: { discoverRunning?: () => Promise<Set<string>> } = {},
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

  // 3. Running set (managed only; external entries are always available)
  const discover = opts.discoverRunning ?? discoverRunningSystems;
  const running = await discover();

  // 4. Pick a target
  let target: SystemConfig;
  if (flags.system) {
    const sys = systems.find((s) => s.id === flags.system);
    if (!sys) {
      fail(
        `No such system '${flags.system}'. Configured: ${describeSystems(systems)}`,
      );
    }
    if (sys.kind === "managed" && !running.has(sys.id)) {
      fail(
        `System '${sys.id}' is not running. Start it with: ixora stack system start ${sys.id}`,
      );
    }
    target = sys;
  } else {
    const available = systems.filter((s) => isAvailable(s, running));
    if (available.length === 0) {
      fail(
        `No systems are available. Start a managed system with \`ixora stack system start <id>\` or register an external one with \`ixora stack system add\`.\nConfigured: ${describeSystems(systems)}`,
      );
    } else if (available.length === 1) {
      target = available[0]!;
    } else {
      // 2+ available — fall back to the configured default if it's set and
      // currently available. Otherwise require the user to disambiguate.
      const defaultId = envGet("IXORA_DEFAULT_SYSTEM");
      const def = available.find((s) => s.id === defaultId);
      if (defaultId && defaultId.length > 0 && def) {
        target = def;
      } else {
        const list = available
          .map((s) =>
            s.kind === "external" ? `${s.id} (external)` : s.id,
          )
          .sort()
          .join(", ");
        const hint =
          defaultId && defaultId.length > 0
            ? `\nDefault system '${defaultId}' is configured but not currently available.`
            : `\nTip: configure a default with \`ixora stack system default <id>\`.`;
        fail(
          `Multiple systems are available. Specify --system <name>.${hint}\nAvailable: ${list}`,
        );
      }
    }
  }

  // 5. Compute baseUrl
  let baseUrl: string;
  if (target.kind === "external") {
    baseUrl = target.url;
  } else {
    const idx = indexAmongManaged(systems, target);
    if (idx === -1) {
      fail(
        `Internal error: managed system '${target.id}' not found in managed subset.`,
      );
    }
    baseUrl = `http://localhost:${getApiPortBase() + idx}`;
  }

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

function describeSystems(systems: SystemConfig[]): string {
  return systems
    .map((s) => (s.kind === "external" ? `${s.id} (external)` : s.id))
    .join(", ");
}

function fail(msg: string): never {
  process.stderr.write(`${chalk.red("Error:")} ${msg}\n`);
  process.exit(1);
}
