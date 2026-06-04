import { APIError } from "@worksofadam/agentos-sdk";
import type { AgentOSClient, AgentStream } from "@worksofadam/agentos-sdk";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { Command, Option } from "commander";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  getBaseUrl,
  getClient,
  urlContext,
} from "../lib/agentos-client.js";
import { handleError } from "../lib/agentos-errors.js";
import { emitDryRunPlan, isDryRun } from "../lib/dry-run.js";
import {
  getOutputFormat,
  outputDetail,
  outputList,
  printJson,
  writeError,
  writeSuccess,
  writeWarning,
} from "../lib/agentos-output.js";
import {
  deletePausedRun,
  listPausedRuns,
  readPausedRun,
} from "../lib/agentos-paused-runs.js";
import type { PausedRunState } from "../lib/agentos-paused-runs.js";
import { requestResumeStream } from "../lib/agentos-resume.js";
import {
  displayPausedToolInfo,
  EXIT_CODE_PAUSED,
  handleNonStreamRun,
  handleStreamRun,
  type StreamRunResult,
} from "../lib/agentos-stream.js";
import {
  buildConfirmPayload,
  buildRejectPayload,
  startBackgroundRun,
} from "../lib/agentos-background.js";
import { writeBackgroundRun } from "../lib/agentos-background-runs.js";
import {
  emitBackgroundStart,
  pausedSummary,
  runsAction,
  watchRun,
} from "../lib/agentos-runs-command.js";

export const agentsCommand = new Command("agents").description("Manage agents");

agentsCommand
  .command("list")
  .description("List all agents")
  .option(
    "--limit <n>",
    "Results per page",
    (v: string) => Number.parseInt(v, 10),
    20,
  )
  .option("--page <n>", "Page number", (v: string) => Number.parseInt(v, 10), 1)
  .action(async (_options, cmd) => {
    try {
      const opts = cmd.optsWithGlobals();
      const client = getClient(cmd);
      const agents = await client.agents.list();

      const limit = opts.limit as number;
      const page = opts.page as number;
      const start = (page - 1) * limit;
      const paged = agents.slice(start, start + limit);
      const meta = {
        page,
        limit,
        total_pages: Math.ceil(agents.length / limit),
        total_count: agents.length,
      };

      outputList(cmd, paged as unknown as Record<string, unknown>[], {
        columns: ["ID", "NAME", "DESCRIPTION"],
        keys: ["id", "name", "description"],
        meta,
      });
    } catch (err) {
      handleError(err, { url: getBaseUrl(cmd) });
    }
  });

agentsCommand
  .command("get")
  .argument("<agent_id>", "Agent ID")
  .description("Get agent details")
  .action(async (agentId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      const agent = await client.agents.get(agentId);

      const format = getOutputFormat(cmd);
      if (format === "json") {
        outputDetail(cmd, agent as Record<string, unknown>, {
          labels: [],
          keys: [],
        });
        return;
      }

      const modelDisplay = agent.model?.model ?? agent.model?.name ?? "N/A";
      outputDetail(
        cmd,
        {
          id: agent.id ?? "",
          name: agent.name ?? "",
          description: agent.description ?? "",
          model: modelDisplay,
        },
        {
          labels: ["ID", "Name", "Description", "Model"],
          keys: ["id", "name", "description", "model"],
        },
      );
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        identifier: agentId,
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("run")
  .argument("<agent_id>", "Agent ID")
  .argument("<message>", "Message to send to the agent")
  .description("Run an agent with a message")
  .option("--stream", "Stream the response via SSE")
  .option("--session-id <id>", "Session ID for conversation context")
  .option("--user-id <id>", "User ID for personalization")
  .option(
    "--background",
    "Dispatch the run server-side and return immediately (requires a database)",
  )
  .option(
    "--bypass-confirmations",
    "Auto-approve any tool calls that require confirmation",
  )
  .option(
    "-i, --interactive",
    "Prompt for approve/reject inline when the run pauses (requires --stream and a TTY)",
  )
  .option(
    "--dry-run",
    "Verify the agent exists and emit the request payload as JSON without running",
  )
  .action(async (agentId: string, message: string, options, cmd) => {
    try {
      if (options.background && options.stream) {
        writeError(
          "--background and --stream are mutually exclusive — background runs are fire-and-forget.",
        );
        process.exitCode = 1;
        return;
      }
      if (options.bypassConfirmations && options.interactive) {
        writeError(
          "--bypass-confirmations and --interactive cannot be combined — one auto-approves, the other prompts.",
        );
        process.exitCode = 1;
        return;
      }
      const client = getClient(cmd);
      if (isDryRun(cmd)) {
        await client.agents.get(agentId);
        emitDryRunPlan({
          action: options.background ? "agents.run.background" : "agents.run",
          target: agentId,
          payload: {
            message,
            session_id: options.sessionId,
            user_id: options.userId,
            stream: options.background ? false : Boolean(options.stream),
            background: Boolean(options.background),
            bypass_confirmations: Boolean(options.bypassConfirmations),
          },
        });
        return;
      }

      if (options.background) {
        const start = await startBackgroundRun(client, "agent", agentId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        writeBackgroundRun({
          run_id: start.run_id,
          resource_type: "agent",
          resource_id: agentId,
          session_id: start.session_id,
          status: start.status,
          prompt: message,
          started_at: new Date().toISOString(),
          bypass_confirmations: Boolean(options.bypassConfirmations),
        });
        emitBackgroundStart(
          "agent",
          start,
          Boolean(options.bypassConfirmations),
        );
        return;
      }

      let result: StreamRunResult | undefined;
      if (options.stream) {
        const stream = await client.agents.runStream(agentId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        result = await handleStreamRun(cmd, stream, "agent", {
          resourceId: agentId,
          prompt: message,
        });
      } else if (options.bypassConfirmations) {
        // Capture the result so a paused non-stream run can be auto-driven.
        const runResult = await client.agents.run(agentId, {
          message,
          sessionId: options.sessionId,
          userId: options.userId,
        });
        await handleNonStreamRun(
          cmd,
          { result: runResult },
          { resourceType: "agent", resourceId: agentId, prompt: message },
        );
        result = pausedSummary(runResult as Record<string, unknown>);
      } else {
        await handleNonStreamRun(
          cmd,
          () =>
            client.agents.run(agentId, {
              message,
              sessionId: options.sessionId,
              userId: options.userId,
            }),
          { resourceType: "agent", resourceId: agentId, prompt: message },
        );
      }

      if (result?.paused && result.runId && options.bypassConfirmations) {
        await watchRun(
          client,
          cmd,
          "agent",
          {
            resourceId: agentId,
            runId: result.runId,
            sessionId: result.sessionId ?? undefined,
            prompt: message,
          },
          { bypass: true, intervalMs: 3000 },
        );
      } else if (
        options.interactive &&
        options.stream &&
        result?.paused &&
        result.runId
      ) {
        await interactiveResume(client, cmd, {
          agentId,
          runId: result.runId,
          sessionId: result.sessionId ?? null,
          pendingTools: result.pendingTools ?? [],
          userId: options.userId,
        });
      }
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        identifier: agentId,
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("runs")
  .argument(
    "[run_id]",
    "Poll one background run; omit to list cached background runs",
  )
  .description("List background runs, or poll/watch one")
  .option("--watch", "Poll until the run reaches a terminal status")
  .option("--status <status>", "Filter the list by status")
  .option(
    "--interval <seconds>",
    "Poll interval for --watch",
    (v: string) => Number.parseInt(v, 10),
    3,
  )
  .option(
    "--session-id <id>",
    "Session ID override (when the cached run has none)",
  )
  .action(runsAction("agent"));

agentsCommand
  .command("continue")
  // The two positionals were originally <agent_id> <run_id>. We now accept
  // either form so users with only the run_id in their scrollback don't
  // have to dig for the agent_id:
  //   ixora agents continue <agent_id> <run_id> [tool_results]   (legacy)
  //   ixora agents continue <run_id>          [tool_results]    (cache lookup)
  // Both positionals are optional in the schema; the action validates and
  // looks up agent_id from ~/.ixora/agentos-paused-runs/<run_id>.json when
  // omitted.
  .argument(
    "[arg1]",
    "agent_id (legacy 2-positional form) OR run_id (cache form)",
  )
  .argument(
    "[arg2]",
    "run_id (when arg1 is agent_id) OR tool_results JSON (cache form)",
  )
  .argument(
    "[tool_results]",
    "Tool results JSON (3-positional form). Optional with --confirm/--reject.",
  )
  .description("Continue an agent run")
  .option("--stream", "Stream the response via SSE")
  .option(
    "--confirm",
    "Confirm the paused tool call (auto-reconstruct payload from cache)",
  )
  .option("--reject [note]", "Reject the paused tool call with optional note")
  .option("--session-id <id>", "Session ID")
  .option("--user-id <id>", "User ID")
  .option(
    "-i, --interactive",
    "Re-prompt for approve/reject inline if the continued run re-pauses (requires --stream)",
  )
  .action(
    async (
      arg1: string | undefined,
      arg2: string | undefined,
      arg3: string | undefined,
      options,
      cmd,
    ) => {
      // Snapshot of the parsed agent_id so the catch handler can echo it.
      // The actual destructure below keeps the original narrowed types.
      let capturedAgentId: string | undefined;
      try {
        const client = getClient(cmd);

        const parsed = parseContinuePositionals(arg1, arg2, arg3);
        if (!parsed.runId) {
          writeError(
            "Provide a run_id (and optionally agent_id). See `ixora agents continue --help`.",
          );
          process.exitCode = 1;
          return;
        }
        let { agentId, runId, toolResults } = parsed;
        capturedAgentId = agentId;

        let cached: PausedRunState | null = null;
        if (!agentId || options.confirm || options.reject !== undefined) {
          cached = readPausedRun(runId);
        }
        if (!agentId) {
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. Pass agent_id explicitly: ixora agents continue <agent_id> ${runId}`,
            );
            process.exitCode = 1;
            return;
          }
          agentId = cached.agent_id;
        }

        let tools: string;
        let sessionId = options.sessionId as string | undefined;

        if (options.confirm) {
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. The cache may have expired (>24h) or this run was never paused.`,
            );
            process.exitCode = 1;
            return;
          }
          tools = buildConfirmPayload(cached.tools);
          if (!sessionId && cached.session_id) sessionId = cached.session_id;
        } else if (options.reject !== undefined) {
          if (!cached) {
            writeError(
              `No cached paused state for run ${runId}. The cache may have expired (>24h) or this run was never paused.`,
            );
            process.exitCode = 1;
            return;
          }
          const note =
            typeof options.reject === "string" ? options.reject : undefined;
          tools = buildRejectPayload(cached.tools, note);
          if (!sessionId && cached.session_id) sessionId = cached.session_id;
        } else if (toolResults) {
          tools = toolResults;
        } else {
          writeError(
            "Provide tool results JSON, or use --confirm/--reject for a paused tool call.",
          );
          process.exitCode = 1;
          return;
        }

        let rePaused = false;
        let streamResult: StreamRunResult | undefined;
        if (options.stream) {
          const stream = await client.agents.continue(agentId, runId, {
            tools,
            sessionId,
            userId: options.userId,
            stream: true,
          });
          streamResult = await handleStreamRun(
            cmd,
            stream as AgentStream,
            "agent",
            { resourceId: agentId, prompt: cached?.prompt },
          );
          rePaused = streamResult.paused;
        } else {
          const result = await client.agents.continue(agentId, runId, {
            tools,
            sessionId,
            userId: options.userId,
            stream: false,
          });
          const status =
            typeof (result as Record<string, unknown>)?.status === "string"
              ? ((result as Record<string, unknown>).status as string).toLowerCase()
              : "";
          rePaused = status === "paused";
          await handleNonStreamRun(
            cmd,
            { result },
            {
              resourceType: "agent",
              resourceId: agentId,
              prompt: cached?.prompt,
            },
          );
        }

        // Only delete the original cache once we're sure the continue resolved
        // the pause (didn't re-pause). For stream, we play it safe and let the
        // 24h TTL clean up stale entries.
        if ((options.confirm || options.reject !== undefined) && !rePaused) {
          deletePausedRun(runId);
        }

        if (
          options.interactive &&
          options.stream &&
          rePaused &&
          streamResult?.runId
        ) {
          await interactiveResume(client, cmd, {
            agentId,
            runId: streamResult.runId,
            sessionId: streamResult.sessionId ?? null,
            pendingTools: streamResult.pendingTools ?? [],
            userId: options.userId,
          });
        }
      } catch (err) {
        handleError(err, {
          resource: "Agent",
          identifier: capturedAgentId,
          listCommand: "ixora agents list",
          ...urlContext(cmd),
        });
      }
    },
  );

agentsCommand
  .command("pending")
  .argument("[run_id]", "Show details for one paused run; omit to list all")
  .description("List runs paused awaiting tool confirmation")
  .action((runId: string | undefined, _options, cmd) => {
    try {
      if (runId) {
        const cached = readPausedRun(runId);
        if (!cached) {
          writeError(
            `No cached paused state for run ${runId}. The cache may have expired (>24h) or this run was never paused.`,
          );
          process.exitCode = 1;
          return;
        }
        const format = getOutputFormat(cmd);
        if (format === "json") {
          process.stdout.write(`${JSON.stringify(cached, null, 2)}\n`);
          return;
        }
        displayPausedToolInfo(
          cached.tools as unknown as Array<Record<string, unknown>>,
          cached.agent_id,
          cached.run_id,
        );
        if (cached.prompt) {
          process.stderr.write(
            `\n${chalk.dim("Original prompt:")} ${cached.prompt}\n`,
          );
        }
        return;
      }

      const all = listPausedRuns();
      const rows = all.map((s) => {
        const ageMs = Date.now() - new Date(s.paused_at ?? 0).getTime();
        const ageMin = Math.max(0, Math.round(ageMs / 60_000));
        return {
          run_id: s.run_id,
          agent_id: s.agent_id,
          age: ageMin >= 60 ? `${Math.round(ageMin / 60)}h` : `${ageMin}m`,
          tools: s.tools.length,
          tool_names: s.tools.map((t) => t.tool_name).join(", "),
        };
      });
      outputList(cmd, rows as unknown as Record<string, unknown>[], {
        columns: ["RUN ID", "AGENT", "AGE", "TOOLS", "TOOL NAMES"],
        keys: ["run_id", "agent_id", "age", "tools", "tool_names"],
        meta: { page: 1, limit: rows.length, total_pages: 1, total_count: rows.length },
      });
      if (rows.length === 0) {
        process.stderr.write(
          `${chalk.dim("No paused runs. The cache lives at ~/.ixora/agentos-paused-runs/ (24h TTL).")}\n`,
        );
      } else {
        process.stderr.write(
          `\n${chalk.dim("Approve:")} ixora agents continue <RUN ID> --confirm --stream\n`,
        );
        process.stderr.write(
          `${chalk.dim("Reject: ")} ixora agents continue <RUN ID> --reject --stream\n`,
        );
      }
    } catch (err) {
      handleError(err, {
        resource: "Paused run",
        identifier: runId,
        listCommand: "ixora agents pending",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("resume")
  .argument("<agent_id>", "Agent ID")
  .argument("<run_id>", "Run ID whose SSE stream you want to reconnect to")
  .description(
    "Resume an SSE stream for an agent run after disconnection (replays missed events)",
  )
  .option(
    "--last-event-index <n>",
    "Index of the last SSE event you received (0-based). Omit to replay from start.",
    (v: string) => Number.parseInt(v, 10),
  )
  .option(
    "--session-id <id>",
    "Session ID — required for database fallback when the run is no longer buffered",
  )
  .action(async (agentId: string, runId: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      const stream = await requestResumeStream(client, "agent", agentId, runId, {
        lastEventIndex: options.lastEventIndex,
        sessionId: options.sessionId,
      });
      await handleStreamRun(cmd, stream, "agent", { resourceId: agentId });
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        identifier: agentId,
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("cancel")
  .argument("<agent_id>", "Agent ID")
  .argument("<run_id>", "Run ID to cancel")
  .description("Cancel an in-progress agent run")
  .option(
    "--dry-run",
    "Verify the agent exists and emit the plan as JSON without cancelling",
  )
  .action(async (agentId: string, runId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      if (isDryRun(cmd)) {
        await client.agents.get(agentId);
        emitDryRunPlan({
          action: "agents.cancel",
          target: agentId,
          payload: { run_id: runId },
        });
        return;
      }
      await client.agents.cancel(agentId, runId);
      writeSuccess(`Cancelled run ${runId} for agent ${agentId}`);
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        identifier: agentId,
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

const STAGES = ["published", "draft"] as const;

// Recognized manifest keys. A manifest with any other top-level key is almost
// always a typo (e.g. `instructionz`) and is rejected rather than silently
// dropped — the server ignores unknown keys, so a typo would otherwise produce
// a misconfigured agent with no warning. `mode` is accepted (the verb sets it)
// but not advertised in the hint.
const MANIFEST_KEYS = new Set([
  "kind",
  "id",
  "name",
  "description",
  "model",
  "db",
  "stage",
  "instructions",
  "toolsets",
  "ibmiTools",
  "options",
  "metadata",
  "mode",
]);
const MANIFEST_KEYS_HINT =
  "kind, id, name, description, model, db, stage, instructions, toolsets, ibmiTools, options, metadata";

interface ApplyAgentResponse {
  component_id: string;
  stage: string;
  version: number | null;
  action: string;
  config_keys?: string[];
  stripped_overrides?: string[];
  tools_written?: number;
}

interface FriendlySpec {
  kind?: string;
  id?: string | null;
  name?: string;
  description?: string;
  model?: string;
  db?: string | null;
  stage?: string;
  instructions?: string;
  toolsets?: string[];
  ibmiTools?: Record<string, unknown>[];
  options?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  mode?: string;
  [key: string]: unknown;
}

agentsCommand
  .command("create")
  .description("Create a new agent from a manifest, stdin, or flags")
  .option("-f, --file <file>", "Manifest YAML file (or '-' / stdin if piped)")
  .option("--name <name>", "Display name")
  .option("--id <id>", "Stable agent id (slug)")
  .option("--model <provider:id>", "Model, e.g. anthropic:claude-sonnet-4-6")
  .option("--instructions <text>", "System prompt / mission")
  .option("--description <text>", "Description")
  .option("--toolsets <a,b,c>", "Comma-separated curated toolset names")
  .option(
    "--ibmi-tools <path>",
    "IBM i SQL tools YAML file (repeatable)",
    collectPaths,
    [],
  )
  .option("--db <id>", "Database id")
  .addOption(new Option("--stage <stage>", "Component stage").choices(STAGES))
  .addOption(new Option("--kind <kind>", "Component kind").choices(["Agent"]))
  .option("--dry-run", "Emit the resolved spec as JSON without creating")
  .action(async (options, cmd) => {
    try {
      const client = getClient(cmd);
      const spec = await resolveSpec(cmd, options, { allowFlagsOnly: true });
      if (spec === null) return;
      spec.mode = "create";

      if (isDryRun(cmd)) {
        emitDryRunPlan({
          action: "agents.create",
          target: spec.id ?? spec.name,
          payload: spec as Record<string, unknown>,
        });
        return;
      }

      try {
        const response = await client.request<ApplyAgentResponse>(
          "POST",
          "/agents:apply",
          {
            // Raw object — the SDK's request() stringifies the body itself
            // (passing a string double-encodes → server 422; see evals.ts).
            body: spec as unknown as BodyInit,
            headers: { "Content-Type": "application/json" },
          },
        );
        reportApply(cmd, response);
      } catch (err) {
        if (err instanceof APIError && err.status === 409) {
          const id = spec.id ?? spec.name ?? "";
          writeError(
            `Agent '${id}' already exists. Use \`ixora agents apply\` or \`ixora agents update\`.`,
          );
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("apply")
  .description(
    "Apply a manifest (upsert). Pass a directory to apply every *.agent.yaml",
  )
  .requiredOption("-f, --file <file|dir>", "Manifest file or directory")
  .option("-R, --recursive", "Recurse into subdirectories (directory input)")
  .option("--dry-run", "Emit the resolved spec(s) as JSON without applying")
  .action(async (options, cmd) => {
    try {
      const client = getClient(cmd);
      const filePath = String(options.file);

      let isDir = false;
      try {
        isDir = statSync(filePath).isDirectory();
      } catch {
        writeError(`Manifest path not found: ${filePath}`);
        process.exitCode = 1;
        return;
      }

      if (!isDir) {
        const spec = await resolveSpec(cmd, options, { allowFlagsOnly: false });
        if (spec === null) return;
        spec.mode = "apply";
        if (isDryRun(cmd)) {
          emitDryRunPlan({
            action: "agents.apply",
            target: spec.id ?? spec.name,
            payload: spec as Record<string, unknown>,
          });
          return;
        }
        const response = await client.request<ApplyAgentResponse>(
          "POST",
          "/agents:apply",
          {
            // Raw object — the SDK's request() stringifies the body itself
            // (passing a string double-encodes → server 422; see evals.ts).
            body: spec as unknown as BodyInit,
            headers: { "Content-Type": "application/json" },
          },
        );
        reportApply(cmd, response);
        return;
      }

      const files = listAgentManifests(filePath, Boolean(options.recursive));
      if (files.length === 0) {
        writeError(`No *.agent.yaml manifests found under ${filePath}`);
        process.exitCode = 1;
        return;
      }

      // Two-phase: parse AND validate every manifest before any POST, so a
      // single bad file can't leave the deployment half-applied (some agents
      // created, the rest silently skipped on the first parse/validation error).
      const specs: FriendlySpec[] = [];
      for (const file of files) {
        const spec = parseManifestFile(file);
        if (spec === null) return; // parseManifestFile set the error + exitCode 1
        if (!validateSpec(spec)) return; // validateSpec set the error + exitCode 1
        spec.mode = "apply";
        specs.push(spec);
      }

      if (isDryRun(cmd)) {
        const plans = specs.map((spec) => ({
          action: "agents.apply",
          target: spec.id ?? spec.name,
          payload: spec as Record<string, unknown>,
        }));
        printJson({ dry_run: true, action: "agents.apply", plans });
        return;
      }

      const results: ApplyAgentResponse[] = [];
      for (const spec of specs) {
        const response = await client.request<ApplyAgentResponse>(
          "POST",
          "/agents:apply",
          {
            // Raw object — the SDK's request() stringifies the body itself
            // (passing a string double-encodes → server 422; see evals.ts).
            body: spec as unknown as BodyInit,
            headers: { "Content-Type": "application/json" },
          },
        );
        results.push(response);
        if (getOutputFormat(cmd) !== "json") {
          warnStrippedOverrides(response);
          writeSuccess(applyLine(response));
        }
      }

      if (getOutputFormat(cmd) === "json") {
        printJson(results);
        return;
      }
      writeSuccess(
        `Applied ${results.length} manifest(s) from ${filePath}.`,
      );
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("update")
  .argument("<agent_id>", "Agent ID to update")
  .description("Update an agent with sparse fields (partial edit)")
  .option("-f, --file <file>", "Manifest YAML file (or stdin if piped)")
  .option("--name <name>", "Display name")
  .option("--model <provider:id>", "Model, e.g. anthropic:claude-sonnet-4-6")
  .option("--instructions <text>", "System prompt / mission")
  .option("--description <text>", "Description")
  .option("--toolsets <a,b,c>", "Comma-separated curated toolset names")
  .option(
    "--ibmi-tools <path>",
    "IBM i SQL tools YAML file (repeatable)",
    collectPaths,
    [],
  )
  .option("--db <id>", "Database id")
  .addOption(new Option("--stage <stage>", "Component stage").choices(STAGES))
  .option("--dry-run", "Emit the resolved spec as JSON without updating")
  .action(async (agentId: string, options, cmd) => {
    try {
      const client = getClient(cmd);
      const spec = await resolveSpec(cmd, options, {
        allowFlagsOnly: true,
        skipIdNameValidation: true,
      });
      if (spec === null) return;
      spec.id = agentId;
      spec.mode = "update";

      // The server has no unchanged-detection on the update path, so an empty
      // update would silently bump the version. Require at least one editable
      // field client-side.
      const editable = [
        "name",
        "description",
        "model",
        "instructions",
        "db",
        "stage",
        "toolsets",
        "ibmiTools",
        "options",
        "metadata",
      ];
      if (!editable.some((k) => spec[k] !== undefined)) {
        writeError(
          "Provide at least one field to update (--name, --model, --instructions, --description, --toolsets, --ibmi-tools, --db, --stage).",
        );
        process.exitCode = 1;
        return;
      }

      if (isDryRun(cmd)) {
        emitDryRunPlan({
          action: "agents.update",
          target: agentId,
          payload: spec as Record<string, unknown>,
        });
        return;
      }

      try {
        const response = await client.request<ApplyAgentResponse>(
          "POST",
          "/agents:apply",
          {
            // Raw object — the SDK's request() stringifies the body itself
            // (passing a string double-encodes → server 422; see evals.ts).
            body: spec as unknown as BodyInit,
            headers: { "Content-Type": "application/json" },
          },
        );
        reportApply(cmd, response);
      } catch (err) {
        if (err instanceof APIError && err.status === 404) {
          writeError(
            `Agent '${agentId}' not found. Run \`ixora agents list\` to see available IDs.`,
          );
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        identifier: agentId,
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand
  .command("delete")
  .argument("<agent_id>", "Agent ID to delete")
  .description("Delete an agent")
  .option("--dry-run", "Verify the agent exists and emit the plan as JSON")
  .action(async (agentId: string, _options, cmd) => {
    try {
      const client = getClient(cmd);

      if (isDryRun(cmd)) {
        await client.agents.get(agentId);
        emitDryRunPlan({ action: "agents.delete", target: agentId });
        return;
      }

      try {
        await client.agents.get(agentId);
      } catch (err) {
        if (err instanceof APIError && err.status === 404) {
          writeError(
            `Agent '${agentId}' not found. Run \`ixora agents list\` to see available IDs.`,
          );
          process.exitCode = 1;
          return;
        }
        throw err;
      }

      await client.request("DELETE", `/agents/${agentId}`);
      writeSuccess(`Deleted agent '${agentId}'`);
    } catch (err) {
      handleError(err, {
        resource: "Agent",
        identifier: agentId,
        listCommand: "ixora agents list",
        ...urlContext(cmd),
      });
    }
  });

// `agents toolsets ...` — browse the curated IBM i toolset catalog used by
// `--toolsets` / the `toolsets:` manifest key. Always emits raw JSON.
const toolsetsSubCommand = new Command("toolsets").description(
  "Browse the curated IBM i toolset catalog (always outputs JSON)",
);

toolsetsSubCommand
  .command("list")
  .description("List all curated IBM i toolsets (always JSON)")
  .action(async (_options, cmd) => {
    try {
      const client = getClient(cmd);
      printJson(await client.request("GET", "/toolsets"));
    } catch (err) {
      handleError(err, { ...urlContext(cmd) });
    }
  });

toolsetsSubCommand
  .command("get")
  .argument("<name>", "Toolset name")
  .description("Show a toolset's tools, descriptions, and parameters (always JSON)")
  .action(async (name: string, _options, cmd) => {
    try {
      const client = getClient(cmd);
      printJson(
        await client.request("GET", `/toolsets/${encodeURIComponent(name)}`),
      );
    } catch (err) {
      handleError(err, {
        resource: "Toolset",
        identifier: name,
        listCommand: "ixora agents toolsets list",
        ...urlContext(cmd),
      });
    }
  });

agentsCommand.addCommand(toolsetsSubCommand);

/**
 * Collector for repeatable `--ibmi-tools <path>` flags.
 */
function collectPaths(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Read all of stdin to a string. Returns "" when stdin is a TTY (interactive).
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Resolve a FriendlySpec from `-f`/stdin/flags, then overlay flag overrides
 * (flags win). Performs client-side validation; on a validation failure it
 * writes the error, sets exit code 1, and returns `null` so the caller can
 * short-circuit. The `mode` field is set by each verb's action.
 */
async function resolveSpec(
  cmd: Command,
  options: Record<string, unknown>,
  opts: { allowFlagsOnly: boolean; skipIdNameValidation?: boolean },
): Promise<FriendlySpec | null> {
  let spec: FriendlySpec = {};

  const ibmiToolsPaths = (options.ibmiTools as string[] | undefined) ?? [];
  // Any manifest-defining flag present? If so, this is a flags-only (or
  // file+flag-override) invocation and we must NOT block on stdin — reading an
  // empty, inherited stdin in a non-TTY context (CI, scripts) would hang.
  const hasManifestFlags =
    options.name !== undefined ||
    options.id !== undefined ||
    options.model !== undefined ||
    options.instructions !== undefined ||
    options.description !== undefined ||
    options.toolsets !== undefined ||
    options.db !== undefined ||
    options.stage !== undefined ||
    options.kind !== undefined ||
    ibmiToolsPaths.length > 0;

  const filePath = options.file as string | undefined;
  if (filePath && filePath !== "-") {
    const parsed = parseManifestFile(filePath);
    if (parsed === null) return null;
    spec = parsed;
  } else if (filePath === "-" || (!filePath && !hasManifestFlags && !process.stdin.isTTY)) {
    // Explicit `-f -`, or implicit stdin only when no flags were given (a piped
    // manifest). Never read stdin in flags-only mode → no hang in automation.
    const raw = await readStdin();
    if (raw.trim()) {
      const parsed = parseYamlSpec(raw, "stdin");
      if (parsed === null) return null;
      spec = parsed;
    }
  } else if (!filePath && !hasManifestFlags && !opts.allowFlagsOnly) {
    writeError(
      "Provide a manifest via -f <file>, stdin, or flags (--name, --model, ...).",
    );
    process.exitCode = 1;
    return null;
  }

  // Overlay flag overrides (flags win over file fields).
  if (options.kind !== undefined) spec.kind = String(options.kind);
  if (options.id !== undefined) spec.id = String(options.id);
  if (options.name !== undefined) spec.name = String(options.name);
  if (options.description !== undefined)
    spec.description = String(options.description);
  if (options.model !== undefined) spec.model = String(options.model);
  if (options.instructions !== undefined)
    spec.instructions = String(options.instructions);
  if (options.db !== undefined) spec.db = String(options.db);
  if (options.stage !== undefined) spec.stage = String(options.stage);
  if (options.toolsets !== undefined) {
    spec.toolsets = String(options.toolsets)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (ibmiToolsPaths.length > 0) {
    const collected = [...(spec.ibmiTools ?? [])];
    for (const path of ibmiToolsPaths) {
      const tool = readIbmiToolFile(path);
      if (tool === null) return null;
      collected.push(tool);
    }
    spec.ibmiTools = collected;
  }

  // Client-side validation (shared with directory apply via validateSpec).
  if (!validateSpec(spec, { skipIdNameValidation: opts.skipIdNameValidation })) {
    return null;
  }

  return spec;
}

/**
 * Client-side spec validation: kind, stage enum, model 'provider:id' shape,
 * and (unless skipped) id/name presence. Writes the error + sets exit code 1
 * and returns false on the first failure; returns true when the spec passes.
 * Shared by resolveSpec and the directory-apply path so both enforce the same
 * checks before anything is POSTed.
 */
function validateSpec(
  spec: FriendlySpec,
  opts: { skipIdNameValidation?: boolean } = {},
): boolean {
  const unknown = Object.keys(spec).filter((k) => !MANIFEST_KEYS.has(k));
  if (unknown.length > 0) {
    writeError(
      `Unknown field(s) in manifest: ${unknown.join(", ")}. Valid keys: ${MANIFEST_KEYS_HINT}.`,
    );
    process.exitCode = 1;
    return false;
  }
  if (spec.kind !== undefined && spec.kind !== "Agent") {
    writeError(`Unsupported kind '${spec.kind}'. Only 'Agent' is supported.`);
    process.exitCode = 1;
    return false;
  }
  if (spec.stage !== undefined && !STAGES.includes(spec.stage as never)) {
    writeError(`Invalid --stage '${spec.stage}'. Use published or draft.`);
    process.exitCode = 1;
    return false;
  }
  if (spec.model !== undefined) {
    const m = String(spec.model);
    const idx = m.indexOf(":");
    const provider = idx >= 0 ? m.slice(0, idx).trim() : "";
    const id = idx >= 0 ? m.slice(idx + 1).trim() : "";
    if (!provider || !id) {
      writeError(
        `Invalid --model '${spec.model}'. Use 'provider:id', e.g. anthropic:claude-sonnet-4-6.`,
      );
      process.exitCode = 1;
      return false;
    }
  }
  if (!opts.skipIdNameValidation) {
    const hasId = typeof spec.id === "string" && spec.id.trim() !== "";
    const hasName = typeof spec.name === "string" && spec.name.trim() !== "";
    if (!hasId && !hasName) {
      writeError(
        "Provide a manifest via -f <file>, stdin, or flags (--name, --model, ...).",
      );
      process.exitCode = 1;
      return false;
    }
  }
  return true;
}

/**
 * Read + parse a manifest file. Returns null (after writing an error and
 * setting exit code 1) on a read or YAML parse failure.
 */
function parseManifestFile(filePath: string): FriendlySpec | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    writeError(`Cannot read manifest file: ${filePath}`);
    process.exitCode = 1;
    return null;
  }
  return parseYamlSpec(raw, filePath);
}

function parseYamlSpec(raw: string, source: string): FriendlySpec | null {
  try {
    const parsed = parse(raw);
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      writeError(`Manifest ${source} must be a YAML mapping.`);
      process.exitCode = 1;
      return null;
    }
    return parsed as FriendlySpec;
  } catch {
    writeError(`Invalid YAML in ${source}.`);
    process.exitCode = 1;
    return null;
  }
}

/**
 * Read + parse a single `--ibmi-tools` file into an object. Returns null
 * (after writing an error) when the path is not a readable file or the YAML
 * is invalid.
 */
function readIbmiToolFile(path: string): Record<string, unknown> | null {
  try {
    if (!statSync(path).isFile()) {
      writeError(`--ibmi-tools path is not a file: ${path}`);
      process.exitCode = 1;
      return null;
    }
  } catch {
    writeError(`--ibmi-tools path not found: ${path}`);
    process.exitCode = 1;
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    writeError(`Cannot read --ibmi-tools file: ${path}`);
    process.exitCode = 1;
    return null;
  }
  try {
    const parsed = parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      writeError(`--ibmi-tools file ${path} must be a YAML mapping.`);
      process.exitCode = 1;
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    writeError(`Invalid YAML in --ibmi-tools file ${path}.`);
    process.exitCode = 1;
    return null;
  }
}

/**
 * Collect `*.agent.yaml` manifests under a directory, sorted. Recurses into
 * subdirectories when `recursive` is set.
 */
function listAgentManifests(dir: string, recursive: boolean): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".agent.yaml")) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort();
}

function applyLine(response: ApplyAgentResponse): string {
  const verb =
    response.action === "created"
      ? "Created"
      : response.action === "updated"
        ? "Updated"
        : "Unchanged";
  const ver = response.version != null ? `, version=${response.version}` : "";
  const tools =
    response.tools_written && response.tools_written > 0
      ? ` (${response.tools_written} IBM i tool(s) written)`
      : "";
  return `${verb} agent '${response.component_id}' (stage=${response.stage}${ver})${tools}`;
}

/**
 * Surface override keys the server stripped (e.g. tools/dependencies/db, which
 * are managed and cannot be overridden) so the user isn't left thinking they
 * took effect. stderr-only via writeWarning, so JSON output stays clean.
 */
function warnStrippedOverrides(response: ApplyAgentResponse): void {
  if (response.stripped_overrides && response.stripped_overrides.length > 0) {
    writeWarning(
      `Ignored protected override key(s): ${response.stripped_overrides.join(", ")}`,
    );
  }
}

function reportApply(cmd: Command, response: ApplyAgentResponse): void {
  if (getOutputFormat(cmd) === "json") {
    printJson(response);
    return;
  }
  warnStrippedOverrides(response);
  writeSuccess(applyLine(response));
}

/**
 * Disambiguate the variadic positional shape on `agents continue`. Returns
 * `{ agentId?, runId, toolResults? }`. The two-positional UUID-then-JSON
 * case is the only one that needs sniffing — everything else is unambiguous
 * by arity.
 */
export function parseContinuePositionals(
  a: string | undefined,
  b: string | undefined,
  c: string | undefined,
): {
  agentId?: string;
  runId?: string;
  toolResults?: string;
} {
  const args = [a, b, c].filter((x): x is string => typeof x === "string");
  if (args.length === 0) return {};
  if (args.length === 1) {
    return { runId: args[0] };
  }
  if (args.length === 2) {
    const second = args[1] ?? "";
    const looksLikeJson =
      second.startsWith("{") || second.startsWith("[") || second.startsWith('"');
    if (looksLikeJson) {
      return { runId: args[0], toolResults: second };
    }
    return { agentId: args[0], runId: second };
  }
  return { agentId: args[0], runId: args[1], toolResults: args[2] };
}

/**
 * Inline approve/reject loop for paused runs. Spawned by `--interactive`.
 * Loops the prompt across re-pauses so multi-turn HITL flows stay in a
 * single terminal session — no copy-paste, no run_id juggling, no
 * --session-id hunting.
 *
 * Quitting leaves the cache intact; the user can pick up later with
 * `ixora agents continue <run_id> --confirm`.
 */
async function interactiveResume(
  client: AgentOSClient,
  cmd: Command,
  ctx: {
    agentId: string;
    runId: string;
    sessionId: string | null;
    pendingTools: PausedRunState["tools"];
    userId?: string;
  },
): Promise<void> {
  if (!process.stdin.isTTY) {
    writeWarning(
      "Skipping interactive resume: stdin is not a TTY. Re-run with `agents continue --confirm --stream`.",
    );
    return;
  }
  let { runId, sessionId, pendingTools } = ctx;
  while (true) {
    const choice = await select<string>({
      message: chalk.yellow.bold(
        `[Run paused] ${pendingTools.length} tool call(s) require confirmation`,
      ),
      choices: [
        { name: "Approve all", value: "approve" },
        { name: "Reject all", value: "reject" },
        { name: "Show details", value: "show" },
        { name: "Quit (cache preserved)", value: "quit" },
      ],
    });

    if (choice === "show") {
      displayPausedToolInfo(
        pendingTools as unknown as Array<Record<string, unknown>>,
        ctx.agentId,
        runId,
      );
      continue;
    }
    if (choice === "quit") {
      process.stderr.write(
        `${chalk.dim("Cache preserved. Resume with:")} ixora agents continue ${runId} --confirm --stream\n`,
      );
      return;
    }

    const tools =
      choice === "approve"
        ? buildConfirmPayload(
            pendingTools as unknown as Array<Record<string, unknown>>,
          )
        : buildRejectPayload(
            pendingTools as unknown as Array<Record<string, unknown>>,
          );

    const stream = await client.agents.continue(ctx.agentId, runId, {
      tools,
      sessionId: sessionId ?? undefined,
      userId: ctx.userId,
      stream: true,
    });
    const next = await handleStreamRun(cmd, stream as AgentStream, "agent", {
      resourceId: ctx.agentId,
    });
    if (!next.paused) {
      // Resolved cleanly — clear the cache and exit the loop. The exit code
      // set by handleStreamRun (4 on pause) gets cleared because the final
      // outcome is success.
      deletePausedRun(runId);
      process.exitCode = 0;
      return;
    }
    // Re-paused — feed new pending state back into the loop.
    runId = next.runId ?? runId;
    sessionId = next.sessionId ?? sessionId;
    pendingTools = next.pendingTools ?? [];
    if (pendingTools.length === 0) {
      writeWarning(
        "Run re-paused but no pending tool calls were extracted; exiting interactive loop.",
      );
      return;
    }
  }
}
