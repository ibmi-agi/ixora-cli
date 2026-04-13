import { envGet } from "./env.js";
import { readSystems } from "./systems.js";
import { success, bold, dim } from "./ui.js";

interface BannerOptions {
  title?: string;
  version?: string;
  previousVersion?: string;
}

function isA2AEnabled(): boolean {
  const raw = envGet("A2A_INTERFACE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function printRunningBanner(opts: BannerOptions = {}): void {
  const systems = readSystems();
  const a2aEnabled = isA2AEnabled();
  const profile = envGet("IXORA_PROFILE") || "full";

  console.log();
  success(opts.title ?? "ixora is running!");

  if (opts.version) {
    console.log(`  ${bold("Version:")} ${opts.version}`);
    if (opts.previousVersion && opts.previousVersion !== opts.version) {
      console.log(`  ${dim(`(was ${opts.previousVersion})`)}`);
    }
  }

  console.log(`  ${bold("UI:")}      http://localhost:3000`);
  console.log(`  ${bold("API:")}     http://localhost:8000`);

  if (systems.length > 1) {
    console.log(`  ${bold("Systems:")} ${systems.length}`);
    let port = 8000;
    for (const sys of systems) {
      const idUpper = sys.id.toUpperCase().replace(/-/g, "_");
      const sysHost = envGet(`SYSTEM_${idUpper}_HOST`);
      console.log(`    ${dim(`:${port} → ${sys.id} (${sysHost})`)}`);
      port++;
    }

    console.log(`  ${bold("MCP:")}`);
    let mcpPort = 8000;
    for (const sys of systems) {
      console.log(
        `    ${dim(`http://localhost:${mcpPort}/mcp → ${sys.id}`)}`,
      );
      mcpPort++;
    }

    if (a2aEnabled) {
      console.log(`  ${bold("A2A:")}`);
      let a2aPort = 8000;
      for (const sys of systems) {
        console.log(
          `    ${dim(`http://localhost:${a2aPort}/a2a → ${sys.id}`)}`,
        );
        a2aPort++;
      }
    }

    console.log(
      `  ${dim("Note: UI connects to first system (:8000) only. Use API ports for other systems.")}`,
    );
  } else {
    console.log(`  ${bold("MCP:")}     http://localhost:8000/mcp`);
    if (a2aEnabled) {
      console.log(`  ${bold("A2A:")}     http://localhost:8000/a2a`);
    }
    console.log(`  ${bold("Profile:")} ${systems[0]?.profile || profile}`);
  }

  console.log();
}
