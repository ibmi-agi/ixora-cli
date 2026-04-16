import { envGet } from "./env.js";
import { readSystems } from "./systems.js";
import { success, bold, dim } from "./ui.js";

interface BannerOptions {
  title?: string;
  version?: string;
  previousVersion?: string;
  runningServices?: Set<string>;
}

function isA2AEnabled(): boolean {
  const raw = envGet("A2A_INTERFACE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function printRunningBanner(opts: BannerOptions = {}): void {
  const allSystems = readSystems();
  const a2aEnabled = isA2AEnabled();
  const profile = envGet("IXORA_PROFILE") || "full";

  // When runningServices is provided, filter systems to those whose api is up.
  // Preserve original index so port assignments (sequential from 8000) stay correct.
  const filter = opts.runningServices;
  const systemsWithPort = allSystems
    .map((sys, idx) => ({ sys, port: 8000 + idx }))
    .filter(
      ({ sys }) => !filter || filter.has(`api-${sys.id}`),
    );

  if (filter && systemsWithPort.length === 0) return;

  const uiRunning = !filter || filter.has("ui");
  const firstSystemPort = systemsWithPort[0]?.port ?? 8000;

  console.log();
  success(opts.title ?? "ixora is running!");

  if (opts.version) {
    console.log(`  ${bold("Version:")} ${opts.version}`);
    if (opts.previousVersion && opts.previousVersion !== opts.version) {
      console.log(`  ${dim(`(was ${opts.previousVersion})`)}`);
    }
  }

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
      console.log(`  ${bold("Profile:")} ${sole.sys.profile || profile}`);
    } else {
      console.log(`  ${bold("MCP:")}     http://localhost:8000/mcp`);
      if (a2aEnabled) {
        console.log(`  ${bold("A2A:")}     http://localhost:8000/a2a`);
      }
      console.log(`  ${bold("Profile:")} ${profile}`);
    }
  }

  console.log();
}
