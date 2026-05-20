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
import type { ResourceType } from "./agentos-stream.js";

// Local index of background runs started from this machine. Modeled on
// agentos-paused-runs.ts. A background run's poll/watch endpoints need
// (resource_id, run_id, session_id) together — caching them keyed by run_id
// is what lets every follow-up command take just the run_id.

const CACHE_DIR = join(IXORA_DIR, "agentos-background-runs");
// 7 days — a background run is a historical record a user may fire one day
// and check the next; longer than the 24h paused-runs TTL, which tracks an
// active obligation. The cache is only a convenience index (the server is the
// source of truth), so expiry just means the bare-run_id shorthand stops
// resolving and the user falls back to the explicit resource_id form.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface BackgroundRunState {
  run_id: string;
  resource_type: ResourceType;
  resource_id: string;
  session_id: string | null;
  /** Last known status — from the start `202` or the most recent poll. */
  status: string;
  /** The message that started the run. */
  prompt: string;
  started_at: string;
  /** True when started with --bypass-confirmations; honored by `runs --watch`. */
  bypass_confirmations: boolean;
}

export function writeBackgroundRun(state: BackgroundRunState): void {
  mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(CACHE_DIR, `${state.run_id}.json`),
    JSON.stringify(state, null, 2),
    { mode: 0o600 },
  );
}

function readBackgroundRunRaw(runId: string): BackgroundRunState | null {
  const filePath = join(CACHE_DIR, `${runId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as BackgroundRunState;
  } catch {
    return null;
  }
}

export function readBackgroundRun(runId: string): BackgroundRunState | null {
  cleanStaleBackgroundRuns();
  return readBackgroundRunRaw(runId);
}

export function listBackgroundRuns(): BackgroundRunState[] {
  cleanStaleBackgroundRuns();
  if (!existsSync(CACHE_DIR)) return [];
  const out: BackgroundRunState[] = [];
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(
        JSON.parse(
          readFileSync(join(CACHE_DIR, file), "utf-8"),
        ) as BackgroundRunState,
      );
    } catch {
      // Skip files that aren't valid JSON — the cache is best-effort.
    }
  }
  // Newest first.
  out.sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  return out;
}

export function deleteBackgroundRun(runId: string): void {
  const filePath = join(CACHE_DIR, `${runId}.json`);
  if (!existsSync(filePath)) return;
  unlinkSync(filePath);
}

/**
 * Patch the cached status (and session_id) after a poll. No-op if the run
 * isn't cached — a poll of an uncached run shouldn't create a cache entry.
 */
export function updateBackgroundRunStatus(
  runId: string,
  status: string,
  sessionId?: string | null,
): void {
  const prev = readBackgroundRunRaw(runId);
  if (!prev) return;
  writeBackgroundRun({
    ...prev,
    status,
    session_id: sessionId ?? prev.session_id,
  });
}

export function cleanStaleBackgroundRuns(): void {
  if (!existsSync(CACHE_DIR)) return;
  const now = Date.now();
  for (const file of readdirSync(CACHE_DIR)) {
    const filePath = join(CACHE_DIR, file);
    if (now - statSync(filePath).mtimeMs > MAX_AGE_MS) {
      unlinkSync(filePath);
    }
  }
}
