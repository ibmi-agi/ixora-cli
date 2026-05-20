import type { AgentOSClient } from "@worksofadam/agentos-sdk";
import { EXIT_CODE_PAUSED } from "./agentos-stream.js";
import type { ResourceType } from "./agentos-stream.js";

// Shared, pure helpers for background runs. The AgentOS SDK's typed
// `run()`/`runStream()` have no `background` field, so background runs go
// through the client's `request()` escape hatch with a hand-built FormData —
// the same pattern `agentos-resume.ts` uses for `requestStream()`.

/**
 * Maps a ResourceType to its REST path segment. Single source of truth —
 * `agentos-resume.ts` and `agentos-runs-command.ts` import this.
 */
export const PATH_PREFIX: Record<ResourceType, string> = {
  agent: "agents",
  team: "teams",
  workflow: "workflows",
};

/** Body of the `202` returned when a run is dispatched with background=true. */
export interface BackgroundRunStart {
  run_id: string;
  session_id: string | null;
  status: string;
}

export interface StartBackgroundRunInput {
  /** The message/prompt. Agents, teams and workflows all take `message`. */
  message: string;
  sessionId?: string;
  userId?: string;
}

/**
 * Build the multipart form for a background run start. Exported so the
 * `--dry-run` path and tests can inspect it without a network call.
 */
export function buildBackgroundForm(input: StartBackgroundRunInput): FormData {
  const form = new FormData();
  form.append("message", input.message);
  form.append("stream", "false");
  form.append("background", "true");
  if (input.sessionId) form.append("session_id", input.sessionId);
  if (input.userId) form.append("user_id", input.userId);
  return form;
}

/**
 * POST `/{plural}/{id}/runs` with background=true, stream=false. Returns the
 * `202` run metadata. Throws if the server did not return a run_id — that
 * means the run was not dispatched in the background (background runs require
 * a database configured on the resource).
 */
export async function startBackgroundRun(
  client: AgentOSClient,
  kind: ResourceType,
  resourceId: string,
  input: StartBackgroundRunInput,
): Promise<BackgroundRunStart> {
  const path = `/${PATH_PREFIX[kind]}/${encodeURIComponent(resourceId)}/runs`;
  const body = await client.request<Record<string, unknown>>("POST", path, {
    body: buildBackgroundForm(input),
  });
  const runId = body?.run_id;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error(
      "Server did not return a run_id — the run was not dispatched in the background. Background runs require a database configured on the resource.",
    );
  }
  return {
    run_id: runId,
    session_id: (body.session_id as string | undefined) ?? null,
    status: (body.status as string | undefined) ?? "PENDING",
  };
}

/**
 * GET `/{plural}/{id}/runs/{run_id}` — poll one run's status and result.
 * Uses the `request()` escape hatch (not the typed `getRun`) so all three
 * resource types go through one code path.
 */
export async function pollBackgroundRun(
  client: AgentOSClient,
  kind: ResourceType,
  resourceId: string,
  runId: string,
  sessionId?: string | null,
): Promise<Record<string, unknown>> {
  let path = `/${PATH_PREFIX[kind]}/${encodeURIComponent(resourceId)}/runs/${encodeURIComponent(runId)}`;
  if (sessionId) path += `?session_id=${encodeURIComponent(sessionId)}`;
  return client.request<Record<string, unknown>>("GET", path);
}

/** True when the run has reached a truly terminal state (done, not pausable). */
export function isFinishedStatus(status: string): boolean {
  const s = status.trim().toUpperCase();
  return (
    s === "COMPLETED" || s === "ERROR" || s === "FAILED" || s === "CANCELLED"
  );
}

/**
 * Map a run status to a process exit code, so a script or coding agent can
 * branch on the outcome without parsing output. Single source of truth for
 * `runs` poll/watch exit codes.
 */
export function exitCodeForStatus(status: string): number {
  switch (status.trim().toUpperCase()) {
    case "COMPLETED":
    case "RUNNING":
    case "PENDING":
      return 0;
    case "PAUSED":
      return EXIT_CODE_PAUSED; // 4
    case "ERROR":
    case "FAILED":
      return 2;
    case "CANCELLED":
      return 1;
    default:
      return 1;
  }
}

/**
 * Stamp `confirmed: true` on each pending tool call and serialize — the
 * payload the `/continue` endpoint expects to approve a paused run.
 * (Moved here from `agentos/agents.ts` so the shared auto-confirm loop and
 * all three command files can reuse it.)
 */
export function buildConfirmPayload(
  tools: Array<Record<string, unknown>>,
): string {
  return JSON.stringify(tools.map((tool) => ({ ...tool, confirmed: true })));
}

/** Stamp `confirmed: false` (+ a note) on each pending tool call and serialize. */
export function buildRejectPayload(
  tools: Array<Record<string, unknown>>,
  note?: string,
): string {
  return JSON.stringify(
    tools.map((tool) => ({
      ...tool,
      confirmed: false,
      confirmation_note: note ?? "Rejected via CLI",
    })),
  );
}
