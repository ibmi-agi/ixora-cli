import { envGet, getApiPortBase } from "./env.js";
import { readSystems } from "./systems.js";
import type { StackProfile } from "./constants.js";
import { VALID_STACK_PROFILES } from "./constants.js";
import { success, bold, dim } from "./ui.js";

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

function readStackProfile(): StackProfile {
  const stored = envGet("IXORA_PROFILE") || "full";
  return VALID_STACK_PROFILES.includes(stored as StackProfile)
    ? (stored as StackProfile)
    : "full";
}

export function printRunningBanner(opts: BannerOptions = {}): void {
  const allSystems = readSystems();
  const a2aEnabled = isA2AEnabled();
  const stackProfile: StackProfile = opts.profile ?? readStackProfile();

  // When runningServices is provided, filter systems to those whose api is up.
  // Preserve original index so port assignments (sequential from base) stay correct.
  const apiPortBase = getApiPortBase();
  const filter = opts.runningServices;
  const systemsWithPort = allSystems
    .map((sys, idx) => ({ sys, port: apiPortBase + idx }))
    .filter(
      ({ sys }) => !filter || filter.has(`api-${sys.id}`),
    );

  if (filter && systemsWithPort.length === 0) return;

  // UI is hidden in `api` stack profile regardless of whether a stale UI
  // container is in the running set.
  const uiInProfile = stackProfile === "full";
  const uiRunning = uiInProfile && (!filter || filter.has("ui"));
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

  if (uiRunning) {
    console.log(`  ${bold("UI:")}      http://localhost:3000`);
  }
  console.log(`  ${bold("API:")}     http://localhost:${firstSystemPort}`);

  if (systemsWithPort.length > 1) {
    console.log(`  ${bold("Systems:")} ${systemsWithPort.length}`);
    for (const { sys, port } of systemsWithPort) {
      const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
      const sysHost = envGet(`SYSTEM_${idUpper}_HOST`);
      console.log(`    ${dim(`:${port} → ${sys.id} (${sysHost})`)}`);
    }

    console.log(`  ${bold("MCP:")}`);
    for (const { sys, port } of systemsWithPort) {
      console.log(
        `    ${dim(`http://localhost:${port}/mcp → ${sys.id}`)}`,
      );
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
      console.log(
        `  ${bold("MCP:")}     http://localhost:${sole.port}/mcp`,
      );
      if (a2aEnabled) {
        console.log(
          `  ${bold("A2A:")}     http://localhost:${sole.port}/a2a`,
        );
      }
      if (sole.sys.profile) {
        console.log(`  ${bold("Agent:")}   ${sole.sys.profile}`);
      }
    } else {
      console.log(`  ${bold("MCP:")}     http://localhost:${apiPortBase}/mcp`);
      if (a2aEnabled) {
        console.log(`  ${bold("A2A:")}     http://localhost:${apiPortBase}/a2a`);
      }
    }
  }

  console.log();
}
