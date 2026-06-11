// Chat controller: the one place that owns live runs and slash dispatch.
//
// submit → runStream (agents/teams/workflows) → for-await → reduce() →
// TurnView.sync → requestRender. On RunPaused the HITL loop (hitl.ts) drives
// pause overlays and STREAMING continues — the continue stream re-enters the
// same consumeStream reduction, so a re-pause re-prompts (openagent defect A)
// and all-rejected still continues (defect B). Esc aborts the local fetch
// AND issues the REST cancel (guarded by the reducer's runCompleted flag —
// abort() only kills the fetch; a paused/finished run must not be cancelled).
//
// Per-message errors render in-transcript — never through handleError (it
// process.exits) — so one transient failure never kills the session.

import type { AgentStream, StreamEvent } from "@worksofadam/agentos-sdk";
import type { Command } from "commander";
import { getClient, getBaseUrl, isUrlOverridden, resetClient } from "../agentos-client.js";
import { getAgentOSContext, setAgentOSContext } from "../agentos-context.js";
import { resolveAgentOSTarget } from "../agentos-resolver.js";
import { readSystems } from "../systems.js";
import { envGet } from "../env.js";
import type { ChatShell } from "./app.js";
import {
  capturePause,
  pendingToolExecutions,
  runHitlLoop,
  type CapturedPause,
  type ContinueRunOptions,
  type ToolExecution,
} from "./hitl.js";
import { createInitialState, finalizeTranscript, reduce } from "./reducer.js";
import type { TranscriptState } from "./types.js";
import { parseSlash, SLASH_COMMANDS } from "./slash.js";
import type { ChatTheme } from "./theme.js";
import { StyledLines, StreamingMarkdown } from "./components/blocks.js";
import {
  showEntityPicker,
  showListPicker,
  type EntityChoice,
  type EntityKind,
  type EntityLists,
} from "./components/pickers.js";
import { promptPauseDecision } from "./components/pause-overlay.js";
import { TurnView, userMessageLine } from "./components/transcript-view.js";

interface EntitySummary {
  id: string;
  name: string;
  description?: string;
}

interface DiscoveredEntities {
  agents: EntitySummary[];
  teams: EntitySummary[];
  workflows: EntitySummary[];
}

export interface ChatStartOptions {
  entity?: { kind: EntityKind; id: string };
  sessionId?: string;
  bypassConfirmations?: boolean;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function strField(obj: Record<string, unknown> | null, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

export class ChatController {
  private entity: EntityChoice | null = null;
  private sessionId: string | null = null;
  private entities: DiscoveredEntities = { agents: [], teams: [], workflows: [] };
  private busy = false;
  private userAborted = false;
  private activeStream: AgentStream | null = null;
  private state: TranscriptState = createInitialState();
  private turnView: TurnView | null = null;
  private lastPauseEvent: StreamEvent | null = null;
  private bypassConfirmations = false;
  private systemLabel: string;

  constructor(
    private readonly app: ChatShell,
    private readonly theme: ChatTheme,
    private readonly cmd: Command,
  ) {
    const ctx = getAgentOSContext();
    this.systemLabel = ctx.systemId ?? ctx.baseUrl;
  }

  /** Boot: discover entities, settle the active entity, optional resume. */
  async start(options: ChatStartOptions): Promise<void> {
    this.bypassConfirmations = options.bypassConfirmations === true;
    // Surface the promise (tests await it); per-message failures render
    // in-transcript and must never become unhandled rejections.
    this.app.onSubmit = (text) =>
      this.handleSubmit(text).catch((err) => this.addError(errMessage(err)));
    this.app.onInterrupt = () => this.interrupt();
    this.app.start();
    this.app.setBusy("connecting...");

    try {
      await this.discoverEntities();
    } catch (err) {
      // Startup failure: nothing useful can happen inside the TUI.
      this.app.restoreTerminal();
      process.stderr.write(
        this.theme.error("Error: ") +
          `cannot reach AgentOS at ${getBaseUrl(this.cmd)}: ${errMessage(err)}\n`,
      );
      process.exit(2);
    }
    this.app.setBusy(null);

    if (options.entity) {
      const found = this.findEntity(options.entity.kind, options.entity.id);
      if (!found) {
        this.app.restoreTerminal();
        process.stderr.write(
          this.theme.error("Error: ") +
            `${options.entity.kind} '${options.entity.id}' not found. ` +
            `Run \`ixora ${options.entity.kind}s list\`\n`,
        );
        process.exit(1);
      }
      this.setEntity(found, { announce: false });
    } else {
      const picked = await this.pickEntity("agent");
      if (!picked) {
        await this.app.exit(0);
      }
    }

    if (options.sessionId) {
      await this.resumeSession(options.sessionId);
    }

    this.addInfo("Type a message to chat, or /help for commands. Esc cancels a run; Ctrl+C twice exits.");
    this.updateHeader();
  }

  // -- input dispatch -----------------------------------------------------

  private async handleSubmit(text: string): Promise<void> {
    const slash = parseSlash(text);
    if (slash === null) {
      await this.runTurn(text);
      return;
    }
    if (slash.kind === "unknown") {
      this.addError(`unknown command '/${slash.name}'. Try /help.`);
      return;
    }
    switch (slash.command) {
      case "exit":
        await this.app.exit(0);
        return;
      case "help":
        this.showHelp();
        return;
      case "new":
        this.sessionId = null;
        this.addInfo("Started a new session.");
        this.updateHeader();
        return;
      case "status":
        this.showStatus();
        return;
      case "tools":
        await this.showTools();
        return;
      case "system":
        await this.switchSystem(slash.args[0]);
        return;
      case "agents":
        await this.switchEntity("agent", slash.args[0]);
        return;
      case "teams":
        await this.switchEntity("team", slash.args[0]);
        return;
      case "workflows":
        await this.switchEntity("workflow", slash.args[0]);
        return;
      case "sessions":
        await this.pickSession(slash.args[0]);
        return;
    }
  }

  // -- run loop -------------------------------------------------------------

  private async runTurn(message: string): Promise<void> {
    if (this.busy) {
      this.app.setHint("A run is in progress — press Esc to cancel it first.");
      return;
    }
    if (!this.entity) {
      this.addError("no entity selected. Use /agents, /teams or /workflows.");
      return;
    }
    this.busy = true;
    this.userAborted = false;
    this.lastPauseEvent = null;
    this.state = createInitialState();
    this.turnView = new TurnView(this.theme);
    this.app.addToTranscript(userMessageLine(this.theme, message));
    this.app.addToTranscript(this.turnView.container);
    this.app.setBusy("thinking...");

    try {
      const stream = await this.startStream(message);
      await this.consumeStream(stream);
      this.adoptSessionId();

      if (this.state.paused && this.lastPauseEvent && !this.userAborted) {
        await this.resolvePauses();
      }

      this.state = finalizeTranscript(this.state);
      this.turnView.sync(this.state);
    } catch (err) {
      this.addError(errMessage(err));
    } finally {
      this.app.setBusy(null);
      this.busy = false;
      this.adoptSessionId();
      this.updateHeader();
      this.app.requestRender();
    }
  }

  private async startStream(message: string): Promise<AgentStream> {
    const client = getClient(this.cmd);
    const entity = this.entity!;
    const options = {
      message,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
    switch (entity.kind) {
      case "agent":
        return client.agents.runStream(entity.id, options);
      case "team":
        return client.teams.runStream(entity.id, options);
      case "workflow":
        return client.workflows.runStream(entity.id, options);
    }
  }

  /**
   * Single-consumption AgentStream: iterate exactly once, reducing into the
   * turn state. Abort-initiated stream errors are swallowed (the synthetic
   * cancelled banner is rendered by interrupt()).
   */
  private async consumeStream(stream: AgentStream): Promise<void> {
    this.activeStream = stream;
    try {
      for await (const event of stream) {
        if (event.event === "RunPaused" || event.event === "TeamRunPaused") {
          this.lastPauseEvent = event;
        }
        const next = reduce(this.state, event);
        if (next !== this.state) {
          this.state = next;
          this.turnView?.sync(this.state);
          this.app.requestRender();
        }
      }
    } catch (err) {
      if (!this.userAborted && !stream.aborted) throw err;
    } finally {
      this.activeStream = null;
    }
  }

  /** Esc: abort the local fetch, REST-cancel the run unless it already ended. */
  interrupt(): void {
    if (!this.busy || !this.activeStream) return;
    this.userAborted = true;
    const { runId, runCompleted } = this.state;
    this.activeStream.abort();
    if (!runCompleted && runId && this.entity) {
      const client = getClient(this.cmd);
      const cancel =
        this.entity.kind === "agent"
          ? client.agents.cancel(this.entity.id, runId)
          : this.entity.kind === "team"
            ? client.teams.cancel(this.entity.id, runId)
            : client.workflows.cancel(this.entity.id, runId);
      void cancel.catch(() => {
        // Best-effort: the local stream is already gone.
      });
    }
    // The aborted fetch will never deliver the server's RunCancelled —
    // synthesize one so the reducer renders the banner.
    const synthetic = {
      event: "RunCancelled",
      created_at: Math.floor(Date.now() / 1000),
      reason: "cancelled by user",
    } as unknown as StreamEvent;
    this.state = reduce(this.state, synthetic);
    this.turnView?.sync(this.state);
    this.app.setBusy(null);
    this.app.requestRender();
  }

  // -- HITL -----------------------------------------------------------------

  private async resolvePauses(): Promise<void> {
    const entity = this.entity!;
    let pause = capturePause(this.lastPauseEvent!, {
      entityId: entity.id,
      runId: this.state.runId,
      sessionId: this.state.sessionId,
    });
    let approveAll = false;
    let gatedCount = countGated(pause);

    const result = await runHitlLoop({
      pause,
      autoApprove: this.bypassConfirmations,
      decide: async (toolExecution: ToolExecution) => {
        if (approveAll) return { approve: true };
        this.app.setBusy(null);
        const choice = await promptPauseDecision(
          this.app.tui,
          this.theme,
          toolExecution,
          gatedCount > 1,
        );
        if (choice.kind === "approve-all") {
          approveAll = true;
          return { approve: true };
        }
        if (choice.kind === "approve") return { approve: true };
        return choice.note ? { approve: false, note: choice.note } : { approve: false };
      },
      continueRun: (runId, options) => this.continueRun(runId, options),
      reduceContinueStream: async (stream): Promise<CapturedPause | null> => {
        this.lastPauseEvent = null;
        this.app.setBusy("continuing...");
        await this.consumeStream(stream as AgentStream);
        this.adoptSessionId();
        if (this.userAborted) return null;
        if (this.state.paused && this.lastPauseEvent) {
          // Re-pause inside the continue stream: fresh requirements, fresh
          // prompts (approve-all applies to one pause round only).
          pause = capturePause(this.lastPauseEvent, {
            entityId: entity.id,
            runId: this.state.runId,
            sessionId: this.state.sessionId,
          });
          approveAll = false;
          gatedCount = countGated(pause);
          return pause;
        }
        return null;
      },
    });

    if (this.bypassConfirmations && result.autoApproved > 0) {
      this.addInfo(
        `auto-approved ${result.autoApproved} tool${result.autoApproved === 1 ? "" : "s"} (--bypass-confirmations)`,
      );
    }
  }

  private continueRun(
    runId: string,
    options: ContinueRunOptions,
  ): Promise<AgentStream | unknown> {
    const client = getClient(this.cmd);
    const entity = this.entity!;
    const args = {
      tools: options.tools,
      sessionId: options.sessionId,
      stream: true,
    };
    switch (entity.kind) {
      case "agent":
        return client.agents.continue(entity.id, runId, args);
      case "team":
        return client.teams.continue(entity.id, runId, args);
      case "workflow":
        return client.workflows.continue(entity.id, runId, args);
    }
  }

  // -- discovery / switching ------------------------------------------------

  private async discoverEntities(): Promise<void> {
    const client = getClient(this.cmd);
    const results = await Promise.allSettled([
      client.agents.list(),
      client.teams.list(),
      client.workflows.list(),
    ]);
    // Agents reachable is the baseline; teams/workflows may legitimately 404
    // on older deployments — treat only total failure as fatal.
    if (results[0].status === "rejected") {
      throw results[0].reason instanceof Error
        ? results[0].reason
        : new Error(String(results[0].reason));
    }
    const summarize = (value: unknown[]): EntitySummary[] =>
      value.flatMap((item) => {
        const rec = asRecord(item);
        const id = strField(rec, "id");
        if (!id) return [];
        return [
          {
            id,
            name: strField(rec, "name") ?? id,
            description: strField(rec, "description"),
          },
        ];
      });
    this.entities = {
      agents: summarize(results[0].value as unknown[]),
      teams: results[1].status === "fulfilled" ? summarize(results[1].value as unknown[]) : [],
      workflows:
        results[2].status === "fulfilled" ? summarize(results[2].value as unknown[]) : [],
    };
  }

  private findEntity(kind: EntityKind, idOrName: string): EntityChoice | null {
    const pool =
      kind === "agent"
        ? this.entities.agents
        : kind === "team"
          ? this.entities.teams
          : this.entities.workflows;
    const match =
      pool.find((e) => e.id === idOrName) ??
      pool.find((e) => e.name.toLowerCase() === idOrName.toLowerCase());
    return match ? { kind, id: match.id, name: match.name } : null;
  }

  private entityLists(): EntityLists {
    const toItems = (pool: EntitySummary[]) =>
      pool.map((e) => ({
        value: e.id,
        label: e.name,
        description: e.description ?? e.id,
      }));
    return {
      agents: toItems(this.entities.agents),
      teams: toItems(this.entities.teams),
      workflows: toItems(this.entities.workflows),
    };
  }

  private async pickEntity(initialTab: EntityKind): Promise<boolean> {
    const choice = await showEntityPicker(
      this.app.tui,
      this.theme,
      this.entityLists(),
      initialTab,
    );
    if (!choice) return false;
    this.setEntity(choice);
    return true;
  }

  private setEntity(choice: EntityChoice, opts: { announce?: boolean } = {}): void {
    const switched = this.entity !== null && this.entity.id !== choice.id;
    this.entity = choice;
    if (switched) this.sessionId = null;
    if (opts.announce !== false) {
      this.addInfo(`Chatting with ${choice.kind} ${choice.name} (${choice.id}).`);
    }
    this.updateHeader();
  }

  private async switchEntity(kind: EntityKind, idOrName?: string): Promise<void> {
    if (this.busy) {
      this.app.setHint("A run is in progress — press Esc to cancel it first.");
      return;
    }
    if (!idOrName) {
      await this.pickEntity(kind);
      return;
    }
    const found = this.findEntity(kind, idOrName);
    if (!found) {
      this.addError(`${kind} '${idOrName}' not found. Run /${kind}s to pick from the list.`);
      return;
    }
    this.setEntity(found);
  }

  private async switchSystem(name?: string): Promise<void> {
    if (this.busy) {
      this.app.setHint("A run is in progress — press Esc to cancel it first.");
      return;
    }
    if (isUrlOverridden(this.cmd)) {
      this.addError("targeting --url directly; /system switching is unavailable.");
      return;
    }
    let target = name;
    if (!target) {
      const systems = readSystems();
      if (systems.length === 0) {
        this.addError("no systems configured. Run `ixora stack system add`.");
        return;
      }
      const defaultId = envGet("IXORA_DEFAULT_SYSTEM");
      const ordered = [...systems].sort((a, b) =>
        a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0,
      );
      const item = await showListPicker(
        this.app.tui,
        this.theme,
        "Switch system",
        ordered.map((s) => ({
          value: s.id,
          label: s.id === defaultId ? `${s.id} (default)` : s.id,
          description: s.kind === "external" ? `external · ${s.url}` : "managed",
        })),
      );
      if (!item) return;
      target = item.value;
    }
    try {
      const ctx = await resolveAgentOSTarget({ system: target });
      setAgentOSContext(ctx);
      resetClient();
      this.systemLabel = ctx.systemId ?? ctx.baseUrl;
      this.sessionId = null;
      this.app.setBusy("discovering entities...");
      await this.discoverEntities();
      this.app.setBusy(null);
      this.addInfo(`Switched to system ${this.systemLabel} (${ctx.baseUrl}).`);
      const stillExists =
        this.entity && this.findEntity(this.entity.kind, this.entity.id);
      if (!stillExists) {
        this.entity = null;
        await this.pickEntity("agent");
      }
      this.updateHeader();
    } catch (err) {
      this.app.setBusy(null);
      this.addError(errMessage(err));
    }
  }

  // -- sessions ---------------------------------------------------------------

  private async pickSession(id?: string): Promise<void> {
    if (this.busy) {
      this.app.setHint("A run is in progress — press Esc to cancel it first.");
      return;
    }
    if (id) {
      await this.resumeSession(id);
      return;
    }
    if (!this.entity) {
      this.addError("no entity selected. Use /agents first.");
      return;
    }
    this.app.setBusy("loading sessions...");
    try {
      const client = getClient(this.cmd);
      const response = await client.sessions.list({
        type: this.entity.kind,
        componentId: this.entity.id,
        limit: 50,
        sortBy: "created_at",
        sortOrder: "desc",
      });
      this.app.setBusy(null);
      const data = asRecord(response)?.data;
      const sessions = Array.isArray(data) ? data : [];
      if (sessions.length === 0) {
        this.addInfo("No sessions found for this entity.");
        return;
      }
      const items = sessions.flatMap((s) => {
        const rec = asRecord(s);
        const sessionId = strField(rec, "session_id");
        if (!sessionId) return [];
        return [
          {
            value: sessionId,
            label: strField(rec, "session_name") ?? sessionId,
            description: strField(rec, "created_at") ?? sessionId,
          },
        ];
      });
      const item = await showListPicker(this.app.tui, this.theme, "Resume session", items);
      if (item) await this.resumeSession(item.value);
    } catch (err) {
      this.app.setBusy(null);
      this.addError(errMessage(err));
    }
  }

  /** Replay prior turns (user message + final content) and thread onto it. */
  private async resumeSession(sessionId: string): Promise<void> {
    this.app.setBusy("loading session...");
    try {
      const client = getClient(this.cmd);
      const runs = await client.sessions.getRuns(sessionId);
      this.app.setBusy(null);
      this.sessionId = sessionId;
      this.addInfo(`Resumed session ${sessionId}.`);
      for (const run of Array.isArray(runs) ? runs : []) {
        const rec = asRecord(run);
        if (!rec) continue;
        const input = extractRunInput(rec.run_input);
        if (input) {
          this.app.addToTranscript(userMessageLine(this.theme, input));
        }
        const content = rec.content;
        const text =
          typeof content === "string" ? content : content ? JSON.stringify(content) : "";
        if (text !== "") {
          const md = new StreamingMarkdown(this.theme);
          md.setText(text);
          this.app.addToTranscript(md);
        }
      }
      this.updateHeader();
    } catch (err) {
      this.app.setBusy(null);
      this.addError(`cannot resume session '${sessionId}': ${errMessage(err)}`);
    }
  }

  private adoptSessionId(): void {
    if (this.state.sessionId) this.sessionId = this.state.sessionId;
  }

  // -- info blocks --------------------------------------------------------------

  private showHelp(): void {
    const t = this.theme;
    const lines = SLASH_COMMANDS.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  ${t.accent(`/${c.name}${hint}`)}  ${t.dim(c.description ?? "")}`;
    });
    this.app.addToTranscript(
      new StyledLines(
        [
          t.bold("Commands"),
          ...lines,
          t.dim("  Esc cancels an in-flight run · Ctrl+C twice exits"),
        ].join("\n"),
      ),
    );
  }

  private showStatus(): void {
    const t = this.theme;
    const ctx = getAgentOSContext();
    const pending = this.state.paused?.toolExecutions.length ?? 0;
    const lines = [
      t.bold("Status"),
      `  system:   ${this.systemLabel}`,
      `  url:      ${getBaseUrl(this.cmd)}`,
      `  entity:   ${this.entity ? `${this.entity.kind} ${this.entity.id}` : "(none)"}`,
      `  session:  ${this.sessionId ?? "(new)"}`,
      `  model:    ${this.state.header?.model ?? "(unknown until first run)"}`,
      `  timeout:  ${ctx.timeout}s`,
      `  pending confirmations: ${pending}`,
    ];
    this.app.addToTranscript(new StyledLines(lines.join("\n")));
    this.app.requestRender();
  }

  private async showTools(): Promise<void> {
    if (!this.entity) {
      this.addError("no entity selected.");
      return;
    }
    this.app.setBusy("loading tools...");
    try {
      const client = getClient(this.cmd);
      const entity = this.entity;
      const detail =
        entity.kind === "agent"
          ? await client.agents.get(entity.id)
          : entity.kind === "team"
            ? await client.teams.get(entity.id)
            : await client.workflows.get(entity.id);
      this.app.setBusy(null);
      const tools = extractTools(asRecord(detail)?.tools);
      const t = this.theme;
      if (tools.length === 0) {
        this.addInfo(`No tools reported for ${entity.kind} ${entity.id}.`);
        return;
      }
      const lines = tools.map((tool) =>
        `  • ${tool.name}${tool.requiresConfirmation ? t.warning(" (requires confirmation)") : ""}`,
      );
      this.app.addToTranscript(
        new StyledLines([t.bold(`Tools — ${entity.kind} ${entity.id}`), ...lines].join("\n")),
      );
    } catch (err) {
      this.app.setBusy(null);
      this.addError(errMessage(err));
    }
  }

  private updateHeader(): void {
    const entity = this.entity
      ? `${this.entity.kind}:${this.entity.id}`
      : "(no entity)";
    const session = this.sessionId ?? "new session";
    this.app.setHeader(`${this.systemLabel} · ${entity} · ${session}`);
  }

  private addInfo(text: string): void {
    this.app.addToTranscript(new StyledLines(this.theme.dim(text)));
  }

  private addError(text: string): void {
    this.app.addToTranscript(new StyledLines(this.theme.error("Error: ") + text));
  }
}

function countGated(pause: CapturedPause): number {
  return pendingToolExecutions(pause).filter(
    (te) => te.requires_confirmation === true,
  ).length;
}

/** RunSchema.run_input is untyped: string, or an object with input content. */
function extractRunInput(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  const rec = asRecord(value);
  if (!rec) return null;
  const direct =
    strField(rec, "input_content") ?? strField(rec, "message") ?? strField(rec, "content");
  if (direct) return direct;
  return null;
}

interface ToolSummary {
  name: string;
  requiresConfirmation: boolean;
}

/**
 * Best-effort tool extraction from the untyped entity detail `tools` field
 * (shape varies by AgentOS version: array of objects, or a wrapper object).
 */
function extractTools(value: unknown): ToolSummary[] {
  const out: ToolSummary[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const rec = asRecord(node);
    if (!rec) {
      if (typeof node === "string" && node !== "") {
        out.push({ name: node, requiresConfirmation: false });
      }
      return;
    }
    const name =
      strField(rec, "name") ?? strField(rec, "tool_name") ?? strField(rec, "function_name");
    if (name) {
      out.push({
        name,
        requiresConfirmation: rec.requires_confirmation === true,
      });
      return;
    }
    for (const child of Object.values(rec)) visit(child);
  };
  visit(value);
  // De-duplicate by name, confirmation flag wins.
  const byName = new Map<string, ToolSummary>();
  for (const tool of out) {
    const existing = byName.get(tool.name);
    if (!existing || tool.requiresConfirmation) byName.set(tool.name, tool);
  }
  return [...byName.values()];
}
