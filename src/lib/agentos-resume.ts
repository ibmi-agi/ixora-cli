import { AgentStream, type AgentOSClient } from "@worksofadam/agentos-sdk";
import type { ResourceType } from "./agentos-stream.js";

// Build the resume-stream endpoint path for the requested resource type.
// Mirrors the FastAPI routes: /{plural}/{id}/runs/{run_id}/resume
const PATH_PREFIX: Record<ResourceType, string> = {
  agent: "agents",
  team: "teams",
  workflow: "workflows",
};

export interface ResumeStreamOptions {
  /** Index of the last SSE event the client received (0-based). Omit to replay from the start. */
  lastEventIndex?: number;
  /** Session ID — required for database fallback when the run completed and rolled out of the buffer. */
  sessionId?: string;
}

/**
 * POST to /{kind}/{resourceId}/runs/{runId}/resume and return an SSE stream.
 *
 * The AgentOS SDK does not (yet) expose a resume helper, so we go through the
 * client's `requestStream` escape hatch and wrap the raw Response with
 * `AgentStream.fromSSEResponse` — the same primitive the SDK uses internally
 * for `runStream` and `continue`.
 */
export async function requestResumeStream(
  client: AgentOSClient,
  kind: ResourceType,
  resourceId: string,
  runId: string,
  options: ResumeStreamOptions = {},
): Promise<AgentStream> {
  const path = `/${PATH_PREFIX[kind]}/${encodeURIComponent(resourceId)}/runs/${encodeURIComponent(runId)}/resume`;

  const formData = new FormData();
  if (options.lastEventIndex !== undefined) {
    formData.append("last_event_index", String(options.lastEventIndex));
  }
  if (options.sessionId) {
    formData.append("session_id", options.sessionId);
  }

  const controller = new AbortController();
  const response = await client.requestStream("POST", path, {
    body: formData,
    signal: controller.signal,
  });
  return AgentStream.fromSSEResponse(response, controller);
}
