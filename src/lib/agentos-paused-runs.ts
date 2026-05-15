import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { IXORA_DIR } from "./constants.js";

// Ported from agno-cli/src/lib/paused-runs.ts.
// Cache directory re-homed under ~/.ixora/ so users don't end up with state
// in two different places.

const CACHE_DIR = join(IXORA_DIR, "agentos-paused-runs");
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PausedRunState {
  agent_id: string;
  run_id: string;
  session_id: string | null;
  resource_type: string;
  paused_at: string;
  tools: Array<{
    tool_call_id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
    requires_confirmation?: boolean;
    confirmed?: boolean | null;
    created_at?: number;
    [key: string]: unknown;
  }>;
}

export function writePausedRun(state: PausedRunState): void {
  mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(CACHE_DIR, `${state.run_id}.json`),
    JSON.stringify(state, null, 2),
    { mode: 0o600 },
  );
}

export function readPausedRun(runId: string): PausedRunState | null {
  cleanStalePausedRuns();
  const filePath = join(CACHE_DIR, `${runId}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as PausedRunState;
}

export function deletePausedRun(runId: string): void {
  const filePath = join(CACHE_DIR, `${runId}.json`);
  if (!existsSync(filePath)) return;
  unlinkSync(filePath);
}

export function cleanStalePausedRuns(): void {
  if (!existsSync(CACHE_DIR)) return;
  const files = readdirSync(CACHE_DIR);
  const now = Date.now();
  for (const file of files) {
    const filePath = join(CACHE_DIR, file);
    const stat = statSync(filePath);
    if (now - stat.mtimeMs > MAX_AGE_MS) {
      unlinkSync(filePath);
    }
  }
}
