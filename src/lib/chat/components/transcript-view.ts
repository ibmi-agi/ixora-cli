// Projection of one run's TranscriptState into pi-tui components.
//
// The reducer returns immutable states with stable block ids; TurnView keeps
// a Map<blockId, view> and on every sync() creates views for new blocks and
// updates existing ones in place (block objects are replaced on change, so a
// reference check per block is enough). Blocks are append-ordered and never
// reorder; nested blocks (parentId) mount inside their container's body.

import { Container, type Component } from "@earendil-works/pi-tui";
import type { Block, TranscriptState } from "../types.js";
import type { ChatTheme } from "../theme.js";
import {
  GroupBlockView,
  MemberBlockView,
  MetricsFooter,
  ReasoningLane,
  StepBlockView,
  StreamingMarkdown,
  StyledLines,
  ToolCallRow,
} from "./blocks.js";

type BlockView =
  | { kind: "text"; component: StreamingMarkdown }
  | { kind: "reasoning"; component: ReasoningLane }
  | { kind: "tool"; component: ToolCallRow }
  | { kind: "member"; component: MemberBlockView }
  | { kind: "step"; component: StepBlockView }
  | { kind: "group"; component: GroupBlockView }
  | { kind: "banner"; component: StyledLines };

export class TurnView {
  readonly container = new Container();
  private readonly views = new Map<string, BlockView>();
  private readonly lastBlock = new Map<string, Block>();
  private readonly footer: MetricsFooter;

  constructor(private readonly theme: ChatTheme) {
    this.footer = new MetricsFooter(theme);
  }

  /** Fold the latest reducer state into the mounted component tree. */
  sync(state: TranscriptState): void {
    for (const block of state.blocks) {
      const existing = this.views.get(block.id);
      if (!existing) {
        this.mount(block);
        continue;
      }
      if (this.lastBlock.get(block.id) === block) continue;
      this.lastBlock.set(block.id, block);
      this.update(existing, block);
    }
    this.footer.setMetrics(state.metrics);
  }

  private parentBody(block: Block): Container {
    if (block.parentId !== null) {
      const parent = this.views.get(block.parentId);
      if (
        parent &&
        (parent.kind === "member" ||
          parent.kind === "step" ||
          parent.kind === "group")
      ) {
        return parent.component.body;
      }
    }
    return this.container;
  }

  private mount(block: Block): void {
    this.lastBlock.set(block.id, block);
    const view = this.createView(block);
    this.views.set(block.id, view);
    this.parentBody(block).addChild(view.component);
    // The metrics footer stays last: re-append after every top-level mount.
    if (block.parentId === null) {
      this.container.removeChild(this.footer);
      this.container.addChild(this.footer);
    }
  }

  private createView(block: Block): BlockView {
    const theme = this.theme;
    switch (block.kind) {
      case "text": {
        const component = new StreamingMarkdown(theme);
        component.setText(block.text);
        return { kind: "text", component };
      }
      case "reasoning":
        return { kind: "reasoning", component: new ReasoningLane(theme, block) };
      case "tool":
        return { kind: "tool", component: new ToolCallRow(theme, block) };
      case "member":
        return { kind: "member", component: new MemberBlockView(theme, block) };
      case "step":
        return { kind: "step", component: new StepBlockView(theme, block) };
      case "group":
        return { kind: "group", component: new GroupBlockView(theme, block) };
      case "error":
        return {
          kind: "banner",
          component: new StyledLines(
            theme.error("Error: ") + block.message,
          ),
        };
      case "cancelled":
        return {
          kind: "banner",
          component: new StyledLines(
            theme.warning(
              `■ cancelled${block.reason ? ` — ${block.reason}` : ""}`,
            ),
          ),
        };
    }
  }

  private update(view: BlockView, block: Block): void {
    switch (view.kind) {
      case "text":
        if (block.kind === "text") view.component.setText(block.text);
        break;
      case "reasoning":
        if (block.kind === "reasoning") view.component.update(block);
        break;
      case "tool":
        if (block.kind === "tool") view.component.update(block);
        break;
      case "member":
        if (block.kind === "member") view.component.update(block);
        break;
      case "step":
        if (block.kind === "step") view.component.update(block);
        break;
      case "group":
        if (block.kind === "group") view.component.update(block);
        break;
      case "banner":
        // Error/cancelled banners are immutable once pushed.
        break;
    }
  }
}

/** A submitted user message, echoed above its turn. */
export function userMessageLine(theme: ChatTheme, text: string): Component {
  return new StyledLines(`${theme.user("you ❯")} ${text}`);
}
