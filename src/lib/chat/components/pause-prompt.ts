// HITL pause prompt: one inline decision per confirmation-gated tool.
//
// Rendered ABOVE the editor (not as a fullscreen overlay) so the transcript
// stays visible — Claude Code-style inline confirmation. Shows the tool name
// + args (capped to a preview; full args are never load-bearing for the
// decision) with Approve / Reject / Reject with note / (Approve all,
// multi-tool pauses only). "Reject with note" swaps to an inline Input for
// the note. Esc/Ctrl+C resolve as REJECT with the default note — the safe
// choice, and the continue is still always sent (HITL defect B), so the run
// can never strand paused. Prompt components are never reused.

import {
  Container,
  Input,
  SelectList,
  Text,
  wrapTextWithAnsi,
  type Component,
  type SelectItem,
} from "@earendil-works/pi-tui";
import type { ToolExecution } from "../hitl.js";
import type { ChatTheme } from "../theme.js";
import type { PromptComponent } from "../app.js";

/** Where inline prompts mount; ChatShell satisfies this structurally. */
export interface PromptHost {
  presentPrompt(component: PromptComponent): void;
  dismissPrompt(): void;
}

export type PauseChoice =
  | { kind: "approve" }
  | { kind: "approve-all" }
  | { kind: "reject"; note?: string };

/** Args previews are capped so one huge payload can't flood the screen. */
const ARGS_PREVIEW_LINES = 8;

/** Capped args body, wrapped to width (never exceeds it). */
class ArgsBody implements Component {
  constructor(
    private readonly theme: ChatTheme,
    private readonly args: Record<string, unknown>,
  ) {}

  render(width: number): string[] {
    let json: string;
    try {
      json = JSON.stringify(this.args, null, 2) ?? "{}";
    } catch {
      json = "(unserializable arguments)";
    }
    const innerWidth = Math.max(1, width - 2);
    const lines = json
      .split("\n")
      .flatMap((line) => wrapTextWithAnsi(this.theme.dim(line), innerWidth));
    const capped = lines.slice(0, ARGS_PREVIEW_LINES);
    if (lines.length > capped.length) {
      capped.push(this.theme.dim(`… (+${lines.length - capped.length} more lines)`));
    }
    return capped.map((line) => "  " + line);
  }

  invalidate(): void {}
}

class PauseDecisionComponent extends Container {
  focused = false;
  private readonly list: SelectList;

  constructor(
    theme: ChatTheme,
    toolExecution: ToolExecution,
    multi: boolean,
    done: (choice: PauseChoice | "reject-note") => void,
  ) {
    super();
    const title = new Text(
      theme.warning("⚠ Tool requires confirmation: ") +
        theme.bold(toolExecution.tool_name),
      1,
      0,
    );
    const items: SelectItem[] = [
      { value: "approve", label: "Approve", description: "Run this tool" },
      { value: "reject", label: "Reject", description: "Do not run this tool" },
      {
        value: "reject-note",
        label: "Reject with note",
        description: "Tell the agent why",
      },
    ];
    if (multi) {
      items.push({
        value: "approve-all",
        label: "Approve all",
        description: "Approve this and every remaining tool in this pause",
      });
    }
    this.list = new SelectList(items, items.length, theme.selectList);
    this.list.onSelect = (item) => {
      switch (item.value) {
        case "approve":
          return done({ kind: "approve" });
        case "approve-all":
          return done({ kind: "approve-all" });
        case "reject-note":
          return done("reject-note");
        default:
          return done({ kind: "reject" });
      }
    };
    this.list.onCancel = () => done({ kind: "reject" });

    this.addChild(title);
    this.addChild(new ArgsBody(theme, toolExecution.tool_args ?? {}));
    this.addChild(new Text("", 0, 0));
    this.addChild(this.list);
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }
}

class RejectNoteComponent extends Container {
  focused = false;
  private readonly input: Input;

  constructor(theme: ChatTheme, done: (note: string | null) => void) {
    super();
    const title = new Text(
      theme.bold("Why reject? ") +
        theme.dim("(Enter to send, Esc to skip the note)"),
      1,
      0,
    );
    this.input = new Input();
    this.input.onSubmit = (value) => {
      const note = value.trim();
      done(note === "" ? null : note);
    };
    this.input.onEscape = () => done(null);
    this.addChild(title);
    this.addChild(this.input);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }
}

/**
 * Prompt for one gated tool execution. Resolves the user's decision; the
 * caller maps it to a HitlDecision (and latches approve-all itself).
 */
export async function promptPauseDecision(
  host: PromptHost,
  theme: ChatTheme,
  toolExecution: ToolExecution,
  multi: boolean,
): Promise<PauseChoice> {
  const first = await new Promise<PauseChoice | "reject-note">((resolve) => {
    let settled = false;
    const component = new PauseDecisionComponent(
      theme,
      toolExecution,
      multi,
      (choice) => {
        if (settled) return;
        settled = true;
        host.dismissPrompt();
        resolve(choice);
      },
    );
    host.presentPrompt(component);
  });

  if (first !== "reject-note") return first;

  const note = await new Promise<string | null>((resolve) => {
    let settled = false;
    const component = new RejectNoteComponent(theme, (value) => {
      if (settled) return;
      settled = true;
      host.dismissPrompt();
      resolve(value);
    });
    host.presentPrompt(component);
  });

  return note === null ? { kind: "reject" } : { kind: "reject", note };
}
