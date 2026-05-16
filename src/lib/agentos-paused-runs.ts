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
  /** Original message that started this run — used by `agents pending` to
   *  surface a re-run hint when the cache outlived its agent_id context. */
  prompt?: string;
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

/**
 * Merge an incoming paused state with whatever's already on disk for this
 * run_id, then write the combined record. Use this whenever the source event
 * may carry partial fields (most notably `session_id`, which the AgentOS
 * RunStarted event omits on re-pause inside a `continue` stream — without
 * the merge, every re-pause would clobber the session_id and the next
 * `--confirm` would 400 with "session_id is required").
 *
 * Tools are NOT merged — the new `tools[]` is the authoritative pending
 * set for the new pause.
 */
export function mergePausedRun(state: PausedRunState): void {
  const prev = readPausedRunRaw(state.run_id);
  writePausedRun({
    ...state,
    session_id: state.session_id ?? prev?.session_id ?? null,
    prompt: state.prompt ?? prev?.prompt,
  });
}

export function readPausedRun(runId: string): PausedRunState | null {
  cleanStalePausedRuns();
  return readPausedRunRaw(runId);
}

function readPausedRunRaw(runId: string): PausedRunState | null {
  const filePath = join(CACHE_DIR, `${runId}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as PausedRunState;
}

export function listPausedRuns(): PausedRunState[] {
  cleanStalePausedRuns();
  if (!existsSync(CACHE_DIR)) return [];
  const out: PausedRunState[] = [];
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const state = JSON.parse(
        readFileSync(join(CACHE_DIR, file), "utf-8"),
      ) as PausedRunState;
      out.push(state);
    } catch {
      // Skip files that aren't valid JSON — the cache is best-effort.
    }
  }
  // Newest first by paused_at when present, else by file mtime.
  out.sort((a, b) => (b.paused_at ?? "").localeCompare(a.paused_at ?? ""));
  return out;
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
