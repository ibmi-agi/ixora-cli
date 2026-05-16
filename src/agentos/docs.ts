import { Command } from "commander";
import { getBaseUrl, getClient } from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
} from "../lib/agentos-output.js";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

type JsonObject = Record<string, unknown>;
type OpenApiSchema = JsonObject;

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: OpenApiSchema;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: OpenApiSchema }>;
    required?: boolean;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: OpenApiSchema }> }
  >;
}

interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

interface EndpointRow {
  method: string;
  path: string;
  operation_id: string;
  tag: string;
  summary: string;
}

async function fetchSpec(cmd: Command): Promise<OpenApiSpec> {
  const client = getClient(cmd);
  // SDK exposes request<T>() as a raw HTTP escape hatch; /openapi.json
  // isn't wrapped by any resource class.
  return client.request<OpenApiSpec>("GET", "/openapi.json");
}

function flattenEndpoints(spec: OpenApiSpec): EndpointRow[] {
  const rows: EndpointRow[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;
      rows.push({
        method: method.toUpperCase(),
        path,
        operation_id: op.operationId ?? "",
        tag: op.tags?.[0] ?? "",
        summary: op.summary ?? "",
      });
    }
  }
  return rows;
}

export const docsCommand = new Command("docs").description(
  "Inspect the AgentOS server's raw HTTP API via /openapi.json",
);

docsCommand
  .command("list")
  .description("List all API endpoints exposed by the AgentOS server")
  .option("--tag <name>", "Filter by tag (case-insensitive)")
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const spec = await fetchSpec(cmd);
      let rows = flattenEndpoints(spec);
      if (typeof opts.tag === "string" && opts.tag.length > 0) {
        const needle = opts.tag.toLowerCase();
        rows = rows.filter((r) => r.tag.toLowerCase() === needle);
      }
      outputList(cmd, rows as unknown as JsonObject[], {
        columns: ["METHOD", "PATH", "OPERATION_ID", "TAG", "SUMMARY"],
        keys: ["method", "path", "operation_id", "tag", "summary"],
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

docsCommand
  .command("show")
  .argument("<key>", "operationId or path (e.g. /eval-runs)")
  .description(
    "Show endpoint details + a generated curl example. Use --method to disambiguate when a path has multiple methods.",
  )
  .option(
    "--method <m>",
    "HTTP method (required when <key> is a path with multiple methods)",
  )
  .action(async (key: string, _options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const spec = await fetchSpec(cmd);
      const match = locateOperation(spec, key, opts.method as string | undefined);
      if (!match.ok) {
        cmd.error(match.error);
        return; // unreachable; cmd.error() exits the process
      }
      const { method, path, op } = match.value;
      const resolvedOp = resolveRefs(op, spec) as OpenApiOperation;
      const baseUrl = getBaseUrl(cmd);

      const reqContent = resolvedOp.requestBody?.content ?? {};
      const reqMime = Object.keys(reqContent)[0] ?? "";
      const reqSchema = reqContent[reqMime]?.schema;

      const respContent =
        resolvedOp.responses?.["200"]?.content ??
        resolvedOp.responses?.["201"]?.content ??
        {};
      const respMime = Object.keys(respContent)[0] ?? "";
      const respSchema = respContent[respMime]?.schema;

      const curl = buildCurl(
        method,
        path,
        resolvedOp,
        reqMime,
        reqSchema,
        baseUrl,
      );

      const detail: JsonObject = {
        method,
        path,
        operation_id: resolvedOp.operationId ?? "",
        tag: resolvedOp.tags?.[0] ?? "",
        summary: resolvedOp.summary ?? "",
        description: resolvedOp.description ?? "",
        parameters: formatParameters(resolvedOp.parameters),
        request_body: reqSchema
          ? `${reqMime}\n${JSON.stringify(reqSchema, null, 2)}`
          : "(none)",
        response_body: respSchema
          ? `${respMime}\n${JSON.stringify(respSchema, null, 2)}`
          : "(none)",
        curl_example: curl,
      };

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, detail, { labels: [], keys: [] });
        return;
      }

      // In table mode, uppercase the method for visual clarity.
      detail.method = method.toUpperCase();

      outputDetail(cmd, detail, {
        labels: [
          "Method",
          "Path",
          "Operation ID",
          "Tag",
          "Summary",
          "Description",
          "Parameters",
          "Request Body",
          "Response Body",
          "Curl Example",
        ],
        keys: [
          "method",
          "path",
          "operation_id",
          "tag",
          "summary",
          "description",
          "parameters",
          "request_body",
          "response_body",
          "curl_example",
        ],
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

docsCommand
  .command("spec")
  .description(
    "Dump the raw OpenAPI JSON spec to stdout (useful for piping to jq)",
  )
  .action(async (_options, cmd) => {
    try {
      const spec = await fetchSpec(cmd);
      process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LocateResult =
  | { ok: true; value: { method: HttpMethod; path: string; op: OpenApiOperation } }
  | { ok: false; error: string };

function locateOperation(
  spec: OpenApiSpec,
  key: string,
  methodFlag?: string,
): LocateResult {
  // 1. Try operationId match across all (path, method) pairs.
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (op?.operationId === key) {
        return { ok: true, value: { method, path, op } };
      }
    }
  }

  // 2. Fall back to path-based lookup.
  const methodsAtPath = spec.paths?.[key];
  if (!methodsAtPath) {
    return { ok: false, error: `No operation found for "${key}"` };
  }

  const available = HTTP_METHODS.filter((m) => methodsAtPath[m]);
  if (available.length === 0) {
    return { ok: false, error: `Path "${key}" has no operations` };
  }

  if (methodFlag) {
    const m = methodFlag.toLowerCase() as HttpMethod;
    if (!HTTP_METHODS.includes(m) || !methodsAtPath[m]) {
      return {
        ok: false,
        error: `Path "${key}" does not support --method ${methodFlag.toUpperCase()}. Available: ${available
          .map((x) => x.toUpperCase())
          .join(", ")}`,
      };
    }
    return {
      ok: true,
      value: { method: m, path: key, op: methodsAtPath[m] as OpenApiOperation },
    };
  }

  if (available.length === 1) {
    const m = available[0] as HttpMethod;
    return {
      ok: true,
      value: { method: m, path: key, op: methodsAtPath[m] as OpenApiOperation },
    };
  }

  return {
    ok: false,
    error: `Path "${key}" has multiple methods (${available
      .map((m) => m.toUpperCase())
      .join(", ")}). Specify with --method <verb>.`,
  };
}

const REF_DEPTH_LIMIT = 4;

// Inline-resolve `$ref` pointers from spec.components.schemas. Depth tracks
// only `$ref` hops (not generic nesting) so cycles get caught — a recursive
// schema that references itself N times bails out after REF_DEPTH_LIMIT hops
// with the literal string "<recursive>".
function resolveRefs(node: unknown, spec: OpenApiSpec, refDepth = 0): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => resolveRefs(n, spec, refDepth));
  }
  if (node && typeof node === "object") {
    const obj = node as JsonObject;
    const refVal = obj.$ref;
    if (typeof refVal === "string" && refVal.startsWith("#/components/schemas/")) {
      if (refDepth >= REF_DEPTH_LIMIT) return "<recursive>";
      const name = refVal.slice("#/components/schemas/".length);
      const target = spec.components?.schemas?.[name];
      if (target) return resolveRefs(target, spec, refDepth + 1);
      return { unresolved_ref: refVal };
    }
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveRefs(v, spec, refDepth);
    }
    return out;
  }
  return node;
}

function formatParameters(params?: OpenApiParameter[]): string {
  if (!params || params.length === 0) return "(none)";
  return params
    .map((p) => {
      const required = p.required ? "required" : "optional";
      const type = (p.schema?.type as string | undefined) ?? "any";
      return `  - ${p.name} (${p.in}, ${type}, ${required})`;
    })
    .join("\n");
}

function buildCurl(
  method: HttpMethod,
  path: string,
  op: OpenApiOperation,
  reqMime: string,
  reqSchema: OpenApiSchema | undefined,
  baseUrl: string,
): string {
  // Collapse Starlette path converters (`/{id:path}`, `/{id:int}`) to `/{id}`
  // first, then substitute placeholders to `<name>`.
  const pathTemplated = path
    .replace(/\{([^{}:]+):[^{}]+\}/g, "{$1}")
    .replace(/\{([^{}]+)\}/g, "<$1>");

  const queryParams = (op.parameters ?? []).filter((p) => p.in === "query");
  const querySuffix =
    queryParams.length > 0
      ? `?${queryParams.map((p) => `${p.name}=<${p.name}>`).join("&")}`
      : "";

  const lines: string[] = [];
  lines.push(`curl -X ${method.toUpperCase()} \\`);
  lines.push(`  "${baseUrl}${pathTemplated}${querySuffix}" \\`);
  lines.push(`  -H "Authorization: Bearer $AGENTOS_KEY"`);

  if (!reqSchema) return lines.join(" \\\n  ").replace(/ \\\n   $/, "");

  if (reqMime === "multipart/form-data") {
    const props = (reqSchema.properties ?? {}) as Record<string, OpenApiSchema>;
    const fieldLines = Object.entries(props).map(
      ([name]) => `  -F "${name}=<${name}>"`,
    );
    return [
      ...lines.slice(0, -1).map((l) => l.replace(/ \\$/, " \\")),
      `${lines[lines.length - 1]} \\`,
      fieldLines.join(" \\\n"),
    ].join("\n");
  }

  // JSON-ish body. Generate a stub from schema then shell-quote.
  const stub = stubFromSchema(reqSchema, 0);
  const stubJson = JSON.stringify(stub, null, 2);
  const quoted = shellSingleQuote(stubJson);
  return [
    ...lines.slice(0, -1).map((l) => l.replace(/ \\$/, " \\")),
    `${lines[lines.length - 1]} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d ${quoted}`,
  ].join("\n");
}

const STUB_DEPTH_LIMIT = 4;

function stubFromSchema(schema: unknown, depth: number): unknown {
  if (depth > STUB_DEPTH_LIMIT) return "<recursive>";
  if (!schema || typeof schema !== "object") return null;
  const s = schema as OpenApiSchema;

  if ("example" in s && s.example !== undefined) return s.example;
  if ("default" in s && s.default !== undefined) return s.default;

  if (Array.isArray(s.anyOf)) {
    const first = (s.anyOf as unknown[]).find(
      (b) => (b as OpenApiSchema)?.type !== "null",
    );
    if (first) return stubFromSchema(first, depth + 1);
  }
  if (Array.isArray(s.oneOf)) {
    return stubFromSchema((s.oneOf as unknown[])[0], depth + 1);
  }

  const type = s.type as string | undefined;
  if (type === "object" || s.properties) {
    const out: JsonObject = {};
    const props = (s.properties ?? {}) as Record<string, OpenApiSchema>;
    for (const [name, child] of Object.entries(props)) {
      out[name] = stubFromSchema(child, depth + 1);
    }
    return out;
  }
  if (type === "array") {
    return [stubFromSchema(s.items, depth + 1)];
  }
  if (type === "string") return "";
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return null;
}

function shellSingleQuote(s: string): string {
  // POSIX-safe single-quote escape: `'` becomes `'\''`.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
