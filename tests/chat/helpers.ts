import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentStream, type StreamEvent } from "@worksofadam/agentos-sdk";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/** Absolute path to a fixture file inside tests/chat/fixtures/. */
export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

/**
 * Replay a recorded SSE fixture through the real SDK parser.
 *
 * Reads tests/chat/fixtures/<name> (".sse" appended if missing), wraps the
 * raw bytes in a Response, and collects every StreamEvent emitted by
 * AgentStream.fromSSEResponse — exactly the parse path live runs take.
 */
export async function replayFixture(name: string): Promise<StreamEvent[]> {
  const file = name.endsWith(".sse") ? name : `${name}.sse`;
  const body = await readFile(fixturePath(file), "utf8");
  const response = new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
  const stream = AgentStream.fromSSEResponse(response, new AbortController());
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

/**
 * Recorded `continue` REQUEST body: the `tools` field is a JSON STRING of the
 * stamped tool_execution array (mirrors the SDK's FormData "tools" field).
 */
export interface RecordedContinueRequest {
  tools: string;
  session_id: string;
}

/**
 * Load a recorded continue request body from tests/chat/fixtures/.
 * Accepts the full file name ("foo.2.request.json") or the stem ("foo.2",
 * ".request.json" appended).
 */
export async function loadRequestFixture(
  name: string,
): Promise<RecordedContinueRequest> {
  const file = name.endsWith(".json") ? name : `${name}.request.json`;
  const body = await readFile(fixturePath(file), "utf8");
  return JSON.parse(body) as RecordedContinueRequest;
}
