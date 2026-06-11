// Leaf components projecting the reducer's block model.
//
// pi-tui component contract: render(width) returns one string per line, no
// line may exceed `width` visible columns (truncateToWidth/wrapTextWithAnsi),
// invalidate() drops render caches, and NOTHING repaints until the caller
// requests a render. Components here are data-only views: TranscriptView
// (transcript-view.ts) creates them per block id and mutates them in place.

import {
  Container,
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import type {
  GroupBlock,
  MemberBlock,
  Metrics,
  ReasoningBlock,
  StepBlock,
  ToolBlock,
} from "../types.js";
import type { BarStyle, ChatTheme } from "../theme.js";

/**
 * Wrap an already full-width line in a background bar. truncateToWidth
 * injects full `\x1b[0m` resets at truncation points — re-open the
 * background after each so the bar spans the entire row.
 */
export function barWrap(line: string, bar: BarStyle): string {
  return (
    bar.open + line.replaceAll("\x1b[0m", "\x1b[0m" + bar.open) + bar.close
  );
}

/** Pad a (already width-truncated) line to full width, then bar-wrap it. */
export function barLine(line: string, width: number, bar: BarStyle): string {
  return barWrap(
    line + " ".repeat(Math.max(0, width - visibleWidth(line))),
    bar,
  );
}

/** Simple line-cache base for width-aware text components. */
abstract class CachedLines implements Component {
  private cache: { width: number; lines: string[] } | null = null;

  render(width: number): string[] {
    if (this.cache && this.cache.width === width) return this.cache.lines;
    const lines = this.renderLines(width);
    this.cache = { width, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = null;
  }

  protected abstract renderLines(width: number): string[];
}

/** Indents a child component, passing the reduced width through. */
export class Indent implements Component {
  constructor(
    readonly inner: Component,
    private readonly prefix = "  ",
  ) {}

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - this.prefix.length);
    return this.inner.render(innerWidth).map((l) => this.prefix + l);
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}

/** Streaming agent text: pi-tui Markdown re-parsed on every delta. */
export class StreamingMarkdown implements Component {
  private readonly md: Markdown;
  private text = "";

  constructor(theme: ChatTheme, dimmed = false) {
    this.md = new Markdown(
      "",
      0,
      0,
      theme.markdown,
      dimmed ? theme.reasoningStyle : undefined,
    );
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.md.setText(text);
  }

  render(width: number): string[] {
    if (this.text.trim() === "") return [];
    return this.md.render(width);
  }

  invalidate(): void {
    this.md.invalidate();
  }
}

/** Result-preview tail length for completed tool calls (pi-style section). */
const RESULT_PREVIEW_LINES = 5;

/**
 * A tool call can succeed at the transport layer while its payload reports a
 * failure — the ibmi-mcp-server returns SQL errors as ordinary text (so the
 * agent can read them and adapt), leaving tool_call_error false. Anchored to
 * the first line to avoid false positives on row data that merely contains
 * the word "Error" (real result rows start with JSON, not an Error: prefix).
 */
export function resultReportsError(result: string | null): boolean {
  if (!result) return false;
  const firstLine = result.trimStart().split("\n", 1)[0] ?? "";
  return /^error\b/i.test(firstLine);
}

/**
 * One tool call as a pi-style tinted section, updated in place: a header row
 * (glyph + name + k=v args summarized by the reducer), then — once the call
 * completes with output — the tail of the result and a "Took X.Xs" row, all
 * on a full-width background bar. Lines never exceed the render width.
 */
export class ToolCallView extends CachedLines {
  private block: ToolBlock;

  constructor(
    private readonly theme: ChatTheme,
    block: ToolBlock,
  ) {
    super();
    this.block = block;
  }

  update(block: ToolBlock): void {
    if (block === this.block) return;
    this.block = block;
    this.invalidate();
  }

  protected renderLines(width: number): string[] {
    const t = this.theme;
    const b = this.block;
    // The call ran, but its payload reports a failure (e.g. a bad SQL
    // statement): distinct from both ✓ (clean result) and ✗ (call failed).
    const reportedError = b.status === "success" && resultReportsError(b.result);
    // closed + still "running" = interrupted (Esc/stream drop closed the
    // block without a completion event) — never show the in-flight glyph.
    const glyph =
      b.status === "running"
        ? b.open
          ? t.dim("◷")
          : t.dim("◌")
        : b.status === "success"
          ? reportedError
            ? t.warning("⚠")
            : t.success("✓")
          : t.error("✗");
    const args = b.argsSummary === "" ? "" : t.dim(`(${b.argsSummary})`);
    const failed = reportedError ? t.warning(" · failed") : "";

    const resultLines =
      b.status === "running" ? [] : (b.result ?? "").trimEnd().split("\n");
    const hasResult = resultLines.some((line) => line.trim() !== "");

    // Without output the duration stays on the header; with output it gets
    // its own pi-style "Took X.Xs" row under the result tail.
    const duration =
      b.durationSeconds !== null ? t.dim(` · ${b.durationSeconds.toFixed(1)}s`) : "";
    const lines = [
      truncateToWidth(
        ` ${glyph} ${t.bold(b.toolName)}${args}${failed}${hasResult ? "" : duration}`,
        width,
      ),
    ];
    if (hasResult) {
      const tail = resultLines.slice(-RESULT_PREVIEW_LINES);
      const hidden = resultLines.length - tail.length;
      if (hidden > 0) {
        lines.push(
          truncateToWidth(
            t.dim(`   … (+${hidden} earlier ${hidden === 1 ? "line" : "lines"})`),
            width,
          ),
        );
      }
      for (const line of tail) {
        lines.push(truncateToWidth(`   ${t.dim(line)}`, width));
      }
      if (b.durationSeconds !== null) {
        lines.push(
          truncateToWidth(t.dim(` Took ${b.durationSeconds.toFixed(1)}s`), width),
        );
      }
    }
    const bar = this.theme.toolBar;
    return bar ? lines.map((line) => barLine(line, width, bar)) : lines;
  }
}

/**
 * Reasoning lane: dim italic markdown while streaming; collapses to a single
 * summary row once the block closes (content stays in the block model).
 */
export class ReasoningLane implements Component {
  private readonly md: StreamingMarkdown;
  private block: ReasoningBlock;

  constructor(
    private readonly theme: ChatTheme,
    block: ReasoningBlock,
  ) {
    this.md = new StreamingMarkdown(theme, true);
    this.block = block;
    this.md.setText(block.text);
  }

  update(block: ReasoningBlock): void {
    if (block === this.block) return;
    this.block = block;
    this.md.setText(block.text);
  }

  render(width: number): string[] {
    if (this.block.text.trim() === "") return [];
    if (!this.block.open) {
      const lineCount = this.block.text.trimEnd().split("\n").length;
      return [
        truncateToWidth(
          this.theme.dim(`✻ reasoned (${lineCount} ${lineCount === 1 ? "line" : "lines"})`),
          width,
        ),
      ];
    }
    return this.md.render(width);
  }

  invalidate(): void {
    this.md.invalidate();
  }
}

/** Container block view: title row + indented children, retitled in place. */
abstract class TitledContainer implements Component {
  readonly body = new Container();
  private readonly indented: Indent;
  private titleCache: { width: number; line: string } | null = null;

  constructor() {
    this.indented = new Indent(this.body);
  }

  render(width: number): string[] {
    if (!this.titleCache || this.titleCache.width !== width) {
      this.titleCache = {
        width,
        line: truncateToWidth(this.title(), width),
      };
    }
    return [
      this.titleCache.line,
      ...this.indented.render(width),
      ...this.extraLines(width),
    ];
  }

  invalidate(): void {
    this.titleCache = null;
    this.indented.invalidate();
  }

  protected retitle(): void {
    this.titleCache = null;
  }

  protected abstract title(): string;

  /** Additional indented lines after the body (e.g. captured step output). */
  protected extraLines(width: number): string[] {
    void width;
    return [];
  }
}

/**
 * Delegated team-member block. Opens with the provisional member_id title,
 * upgrades to agent_name on the member's RunStarted, shows status on close.
 */
export class MemberBlockView extends TitledContainer {
  private block: MemberBlock;

  constructor(
    private readonly theme: ChatTheme,
    block: MemberBlock,
  ) {
    super();
    this.block = block;
  }

  update(block: MemberBlock): void {
    if (block === this.block) return;
    this.block = block;
    this.retitle();
  }

  protected title(): string {
    const t = this.theme;
    const b = this.block;
    // closed + still "running" = interrupted mid-delegation; don't claim ✓.
    const glyph = b.open
      ? t.member("▸")
      : b.status === "error"
        ? t.error("✗")
        : b.status === "running"
          ? t.dim("◌")
          : t.success("✓");
    const task = b.task ? t.dim(` — ${b.task}`) : "";
    return `${glyph} ${t.member(t.bold(b.name))}${task}`;
  }
}

/** Workflow step block: "■ step 1.0: step-name" + indented executor events. */
export class StepBlockView extends TitledContainer {
  private block: StepBlock;

  constructor(
    private readonly theme: ChatTheme,
    block: StepBlock,
  ) {
    super();
    this.block = block;
  }

  update(block: StepBlock): void {
    if (block === this.block) return;
    this.block = block;
    this.retitle();
  }

  protected title(): string {
    const t = this.theme;
    const b = this.block;
    const failed = b.output?.success === false || Boolean(b.output?.error);
    const glyph = b.open ? t.step("■") : failed ? t.error("✗") : t.success("✓");
    const index = b.stepIndexLabel !== null ? `${b.stepIndexLabel}: ` : "";
    const name = b.stepName ?? b.stepId ?? "step";
    const duration =
      b.durationSeconds !== null ? t.dim(` · ${b.durationSeconds.toFixed(1)}s`) : "";
    const executor = b.executorName ? t.dim(` (${b.executorName})`) : "";
    return `${glyph} ${t.step(`step ${index}`)}${t.bold(name)}${executor}${duration}`;
  }

  /**
   * Steps with non-streaming executors produce their text only via
   * StepOutput/StepCompleted content — render it when nothing streamed
   * into the body (the captured output is otherwise invisible).
   */
  protected override extraLines(width: number): string[] {
    const content = this.block.output?.content;
    const error = this.block.output?.error;
    if (this.body.children.length > 0) return [];
    const text = error ? `Error: ${error}` : content;
    if (!text) return [];
    const innerWidth = Math.max(1, width - 2);
    return text
      .trimEnd()
      .split("\n")
      .flatMap((line) =>
        wrapTextWithAnsi(
          error ? this.theme.error(line) : this.theme.dim(line),
          innerWidth,
        ),
      )
      .map((line) => "  " + line);
  }
}

/** Workflow grouping construct (parallel/condition/loop/router/steps). */
export class GroupBlockView extends TitledContainer {
  private block: GroupBlock;

  constructor(
    private readonly theme: ChatTheme,
    block: GroupBlock,
  ) {
    super();
    this.block = block;
  }

  update(block: GroupBlock): void {
    if (block === this.block) return;
    this.block = block;
    this.retitle();
  }

  protected title(): string {
    const t = this.theme;
    const b = this.block;
    const glyph = b.open ? t.step("⧉") : t.success("✓");
    const detail = groupDetail(b);
    return `${glyph} ${t.step(b.groupType)}${b.stepName ? ` ${t.bold(b.stepName)}` : ""}${detail ? t.dim(` (${detail})`) : ""}`;
  }
}

function groupDetail(block: GroupBlock): string {
  const m = block.meta;
  const parts: string[] = [];
  if (typeof m.parallel_step_count === "number") {
    parts.push(`${m.parallel_step_count} steps`);
  }
  if (typeof m.condition_result === "boolean") {
    parts.push(`condition: ${m.condition_result}`);
  }
  if (typeof m.iteration === "number") {
    const max = typeof m.max_iterations === "number" ? `/${m.max_iterations}` : "";
    parts.push(`iteration ${m.iteration}${max}`);
  }
  if (typeof m.total_iterations === "number") {
    parts.push(`${m.total_iterations} iterations`);
  }
  if (Array.isArray(m.selected_steps) && m.selected_steps.length > 0) {
    parts.push(`selected: ${m.selected_steps.join(", ")}`);
  }
  return parts.join(", ");
}

/** Static styled lines (error banners, cancelled banners, info lines). */
export class StyledLines extends CachedLines {
  constructor(private text: string) {
    super();
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.invalidate();
  }

  protected renderLines(width: number): string[] {
    if (this.text === "") return [];
    return this.text
      .split("\n")
      .flatMap((line) => wrapTextWithAnsi(line, width));
  }
}

/** Dim one-line run metrics footer (same fields as printMetrics). */
export class MetricsFooter extends CachedLines {
  private metrics: Metrics | null = null;

  constructor(private readonly theme: ChatTheme) {
    super();
  }

  setMetrics(metrics: Metrics | null): void {
    if (metrics === this.metrics) return;
    this.metrics = metrics;
    this.invalidate();
  }

  protected renderLines(width: number): string[] {
    if (!this.metrics) return [];
    const m = this.metrics;
    const parts: string[] = [];
    if (m.input_tokens && m.output_tokens) {
      parts.push(`tokens: ${m.input_tokens}/${m.output_tokens}`);
    } else if (m.total_tokens) {
      parts.push(`tokens: ${m.total_tokens}`);
    }
    if (m.duration) parts.push(`time: ${m.duration.toFixed(2)}s`);
    if (parts.length === 0) return [];
    return [truncateToWidth(this.theme.dim(`[${parts.join(", ")}]`), width)];
  }
}
