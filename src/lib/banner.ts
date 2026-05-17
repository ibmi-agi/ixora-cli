import { envGet, getApiPortBase } from "./env.js";
import { getManagedSystems, readSystems } from "./systems.js";
import type { StackProfile } from "./constants.js";
import { VALID_STACK_PROFILES } from "./constants.js";
import { info, success, bold, dim } from "./ui.js";

interface BannerOptions {
  title?: string;
  version?: string;
  previousVersion?: string;
  runningServices?: Set<string>;
  profile?: StackProfile;
}

function isA2AEnabled(): boolean {
  const raw = envGet("A2A_INTERFACE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function isCliMode(profile: StackProfile): boolean {
  if (profile === "cli") return true;
  const raw = envGet("IXORA_CLI_MODE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function readStackProfile(): StackProfile {
  const stored = envGet("IXORA_PROFILE") || "full";
  return VALID_STACK_PROFILES.includes(stored as StackProfile)
    ? (stored as StackProfile)
    : "full";
}

export function printRunningBanner(opts: BannerOptions = {}): void {
  // Banner only describes locally-running compose services, so external
  // systems are excluded — they have no MCP/A2A endpoint here. Index over
  // the managed-only subset so port assignments match multi-compose.ts.
  const managed = getManagedSystems(readSystems());
  const a2aEnabled = isA2AEnabled();
  const stackProfile: StackProfile = opts.profile ?? readStackProfile();

  const apiPortBase = getApiPortBase();
  const filter = opts.runningServices;
  const systemsWithPort = managed
    .map((sys, idx) => ({ sys, port: apiPortBase + idx }))
    .filter(
      ({ sys }) => !filter || filter.has(`api-${sys.id}`),
    );

  if (filter && systemsWithPort.length === 0) return;

  // UI is shown only in the `full` stack profile, regardless of whether a
  // stale UI container is in the running set.
  const uiInProfile = stackProfile === "full";
  const uiRunning = uiInProfile && (!filter || filter.has("ui"));
  // In CLI mode there is no MCP container — agents use the bundled `ibmi`
  // binary inside the API container, so don't advertise MCP endpoints.
  const cliMode = isCliMode(stackProfile);
  const firstSystemPort = systemsWithPort[0]?.port ?? apiPortBase;

  console.log();
  success(opts.title ?? "ixora is running!");

  if (opts.version) {
    console.log(`  ${bold("Version:")} ${opts.version}`);
    if (opts.previousVersion && opts.previousVersion !== opts.version) {
      console.log(`  ${dim(`(was ${opts.previousVersion})`)}`);
    }
  }

  console.log(`  ${bold("Stack:")}   ${stackProfile}`);
  if (cliMode) {
    console.log(`  ${bold("Backend:")} ibmi CLI (in-container — no MCP server)`);
  }

  if (uiRunning) {
    console.log(`  ${bold("UI:")}      http://localhost:13000`);
  }
  console.log(`  ${bold("API:")}     http://localhost:${firstSystemPort}`);

  if (systemsWithPort.length > 1) {
    console.log(`  ${bold("Systems:")} ${systemsWithPort.length}`);
    for (const { sys, port } of systemsWithPort) {
      const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
      const sysHost = envGet(`SYSTEM_${idUpper}_HOST`);
      console.log(`    ${dim(`:${port} → ${sys.id} (${sysHost})`)}`);
    }

    if (!cliMode) {
      console.log(`  ${bold("MCP:")}`);
      for (const { sys, port } of systemsWithPort) {
        console.log(
          `    ${dim(`http://localhost:${port}/mcp → ${sys.id}`)}`,
        );
      }
    }

    if (a2aEnabled) {
      console.log(`  ${bold("A2A:")}`);
      for (const { sys, port } of systemsWithPort) {
        console.log(
          `    ${dim(`http://localhost:${port}/a2a → ${sys.id}`)}`,
        );
      }
    }

    if (uiRunning) {
      console.log(
        `  ${dim(`Note: UI connects to first system (:${firstSystemPort}) only. Use API ports for other systems.`)}`,
      );
    }
  } else {
    const sole = systemsWithPort[0];
    if (sole) {
      if (!cliMode) {
        console.log(
          `  ${bold("MCP:")}     http://localhost:${sole.port}/mcp`,
        );
      }
      if (a2aEnabled) {
        console.log(
          `  ${bold("A2A:")}     http://localhost:${sole.port}/a2a`,
        );
      }
      console.log(`  ${bold("Mode:")}    ${sole.sys.mode}`);
    } else {
      if (!cliMode) {
        console.log(
          `  ${bold("MCP:")}     http://localhost:${apiPortBase}/mcp`,
        );
      }
      if (a2aEnabled) {
        console.log(`  ${bold("A2A:")}     http://localhost:${apiPortBase}/a2a`);
      }
    }
  }

  console.log();
}

export function printUsageBanner(): void {
  info("ixora CLI usage:");
  console.log(`  ${bold("Manage with:")}     ixora stack ...`);
  console.log(
    `  ${bold("Talk to AgentOS:")} ixora agents|teams|workflows|traces|sessions|knowledge ...`,
  );
  console.log();
}
