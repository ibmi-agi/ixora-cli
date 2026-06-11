// `ixora chat` TUI shell.
//
// Layout (top to bottom): header · transcript · status line · editor.
// Raw-mode terminal rules this shell owns (each one is a recon-verified
// footgun, not polish):
//   - Raw mode swallows SIGINT: Ctrl+C arrives as data. First press clears
//     the editor (or shows an exit hint when empty); second press within 1s
//     exits. Esc cancels the in-flight run WITHOUT exiting.
//   - Every exit path — /exit, double Ctrl+C, crash, signal — must restore
//     the terminal: drainInput(1000) then tui.stop(). uncaughtException /
//     unhandledRejection handlers are PREPENDED so they run before the
//     global handlers in src/index.ts (which process.exit without stopping
//     the TUI and would strand the user's terminal in raw mode).
//   - The TUI owns stdout while running: no console.log/ora anywhere in the
//     chat path; all output goes through components.
//   - Nothing repaints automatically: state mutations are followed by
//     requestRender() (pi-tui throttles internally).

import {
  Container,
  Editor,
  Loader,
  ProcessTerminal,
  Text,
  TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { createSlashAutocompleteProvider } from "./slash.js";
import type { ChatTheme } from "./theme.js";

const CTRL_C_EXIT_WINDOW_MS = 1000;

/** An inline prompt: mounted above the editor, owns the keyboard while shown. */
export type PromptComponent = Component & {
  focused: boolean;
  handleInput(data: string): void;
};

/**
 * The shell surface the chat controller drives. ChatApp is the real
 * terminal-backed implementation; tests substitute a headless fake.
 */
export interface ChatShell {
  readonly tui: TUI;
  /** A chat message or slash command was submitted (returned promise is awaitable). */
  onSubmit: (text: string) => unknown;
  /** Esc pressed outside overlays/inline prompts/autocomplete. */
  onInterrupt: () => void;
  /** Cleanup before process exit (best-effort). */
  onBeforeExit: () => void | Promise<void>;
  start(): void;
  exit(code?: number): Promise<never>;
  restoreTerminal(): void;
  setHeader(text: string): void;
  addToTranscript(component: Component): void;
  /** Drop every transcript component (the /clear command). */
  clearTranscript(): void;
  setBusy(message: string | null): void;
  setHint(text: string): void;
  /** Persistent status bar under the editor: dim left text, right-aligned right text. */
  setFooter(left: string, right: string): void;
  /** Mount an inline prompt above the editor and give it keyboard focus. */
  presentPrompt(component: PromptComponent): void;
  /** Remove the inline prompt and refocus the editor. */
  dismissPrompt(): void;
  /** Replace the editor with a selector (pi-style) and give it keyboard focus. */
  presentSelector(component: PromptComponent): void;
  /** Restore the editor in place of the selector and refocus it. */
  dismissSelector(): void;
  requestRender(): void;
}

/** pi-style footer line: dim left segment, right segment pushed to the edge. */
class StatusBar implements Component {
  private left = "";
  private right = "";

  constructor(private readonly theme: ChatTheme) {}

  set(left: string, right: string): void {
    this.left = left;
    this.right = right;
  }

  render(width: number): string[] {
    if (this.left === "" && this.right === "") return [];
    const left = this.theme.dim(this.left);
    if (this.right === "") return [truncateToWidth(left, width)];
    const right = this.theme.dim(this.right);
    const gap = width - visibleWidth(left) - visibleWidth(right);
    if (gap >= 1) return [left + " ".repeat(gap) + right];
    // Too narrow for both: truncate the left side to keep the right (token
    // totals + model) visible; drop the right only when there's no room at all.
    const leftRoom = width - visibleWidth(right) - 1;
    if (leftRoom < 8) return [truncateToWidth(left, width)];
    return [truncateToWidth(left, leftRoom, "...", true) + " " + right];
  }

  invalidate(): void {}
}

export class ChatApp implements ChatShell {
  readonly tui: TUI;
  readonly editor: Editor;
  /** The scrolling transcript area; the controller appends turn views. */
  readonly transcript = new Container();

  onSubmit: (text: string) => unknown = () => {};
  onInterrupt: () => void = () => {};
  onBeforeExit: () => void | Promise<void> = () => {};

  private readonly headerLine: Text;
  private readonly statusSlot = new Container();
  private readonly promptSlot = new Container();
  /** Holds the editor, or a selector standing in for it (pi-style). */
  private readonly editorSlot = new Container();
  private promptActive = false;
  private selectorActive = false;
  private readonly loader: Loader;
  private readonly hintLine = new Text("", 0, 0);
  private readonly footerLine: StatusBar;
  private lastCtrlCAt = 0;
  private exiting = false;
  private headerText = "";
  private readonly removeCrashHandlers: () => void;

  constructor(private readonly theme: ChatTheme) {
    this.tui = new TUI(new ProcessTerminal(), false);
    this.headerLine = new Text("", 0, 0);
    this.loader = new Loader(
      this.tui,
      theme.accent,
      theme.dim,
      "working...",
    );
    // pi-tui's Loader starts its animation interval in the CONSTRUCTOR
    // (setIndicator → start()) — stop it until setBusy() actually shows it,
    // or an invisible ~10Hz re-render loop runs for the whole session.
    this.loader.stop();
    this.editor = new Editor(this.tui, theme.editor);
    this.editor.setAutocompleteProvider(createSlashAutocompleteProvider());
    this.editor.onSubmit = (text) => this.handleSubmit(text);
    this.footerLine = new StatusBar(theme);

    this.editorSlot.addChild(this.editor);
    this.tui.addChild(this.headerLine);
    this.tui.addChild(this.transcript);
    this.tui.addChild(this.statusSlot);
    this.tui.addChild(this.promptSlot);
    this.tui.addChild(this.editorSlot);
    this.tui.addChild(this.hintLine);
    this.tui.addChild(this.footerLine);

    this.tui.addInputListener((data) => this.handleGlobalKeys(data));

    // Last-resort terminal restoration. Prepended so these run BEFORE the
    // process-wide handlers in src/index.ts, which exit without tui.stop().
    const onFatal = (err: unknown) => {
      this.restoreTerminal();
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      process.stderr.write(`Error: chat crashed: ${message}\n`);
      process.exit(1);
    };
    const onSignal = () => {
      this.restoreTerminal();
      process.exit(130);
    };
    process.prependListener("uncaughtException", onFatal);
    process.prependListener("unhandledRejection", onFatal);
    // Keyboard Ctrl+C never raises SIGINT in raw mode, but an external
    // `kill -INT` still does — without a handler it terminates the process
    // with the terminal stranded in raw mode.
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);
    this.removeCrashHandlers = () => {
      process.removeListener("uncaughtException", onFatal);
      process.removeListener("unhandledRejection", onFatal);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      process.removeListener("SIGHUP", onSignal);
    };
  }

  start(): void {
    this.tui.setFocus(this.editor);
    this.tui.start();
    this.tui.requestRender();
  }

  /** Graceful exit: drain pending input, restore the terminal, then exit. */
  async exit(code = 0): Promise<never> {
    if (this.exiting) {
      // Re-entry (e.g. second Ctrl+C while draining): exit immediately.
      this.restoreTerminal();
      process.exit(code);
    }
    this.exiting = true;
    try {
      await this.onBeforeExit();
    } catch {
      // Best-effort cleanup only.
    }
    try {
      await this.tui.terminal.drainInput(1000);
    } catch {
      // drainInput is best-effort; never block exit on it.
    }
    this.restoreTerminal();
    process.exit(code);
  }

  /** Synchronous terminal restore for crash/signal paths. */
  restoreTerminal(): void {
    try {
      this.tui.stop();
    } catch {
      // Terminal may already be stopped.
    }
    this.removeCrashHandlers();
  }

  // -- layout helpers ---------------------------------------------------

  setHeader(text: string): void {
    this.headerText = text;
    this.headerLine.setText(
      truncateToWidth(
        this.theme.dim("ixora chat · ") + this.theme.accent(text),
        Math.max(20, this.tui.terminal.columns),
      ),
    );
    this.tui.requestRender();
  }

  getHeader(): string {
    return this.headerText;
  }

  /** Append a component to the transcript (turn views, info lines, ...). */
  addToTranscript(component: Component): void {
    this.transcript.addChild(component);
    this.tui.requestRender();
  }

  clearTranscript(): void {
    this.transcript.clear();
    this.tui.requestRender();
  }

  setFooter(left: string, right: string): void {
    this.footerLine.set(left, right);
    this.tui.requestRender();
  }

  presentPrompt(component: PromptComponent): void {
    this.promptSlot.clear();
    this.promptSlot.addChild(component);
    this.promptActive = true;
    this.tui.setFocus(component);
    this.tui.requestRender();
  }

  dismissPrompt(): void {
    this.promptSlot.clear();
    this.promptActive = false;
    this.tui.setFocus(this.editor);
    this.tui.requestRender();
  }

  presentSelector(component: PromptComponent): void {
    this.editorSlot.clear();
    this.editorSlot.addChild(component);
    this.selectorActive = true;
    this.tui.setFocus(component);
    this.tui.requestRender();
  }

  dismissSelector(): void {
    this.editorSlot.clear();
    this.editorSlot.addChild(this.editor);
    this.selectorActive = false;
    this.tui.setFocus(this.editor);
    this.tui.requestRender();
  }

  /** Spinner + message while a run is in flight; null stops and clears. */
  setBusy(message: string | null): void {
    if (message === null) {
      this.loader.stop();
      this.statusSlot.clear();
    } else {
      if (this.statusSlot.children.length === 0) {
        this.statusSlot.addChild(this.loader);
        this.loader.start();
      }
      this.loader.setMessage(message);
    }
    this.tui.requestRender();
  }

  /** Transient one-line hint under the editor ("" clears). */
  setHint(text: string): void {
    this.hintLine.setText(text === "" ? "" : this.theme.dim(text));
    this.tui.requestRender();
  }

  requestRender(): void {
    this.tui.requestRender();
  }

  // -- input ------------------------------------------------------------

  private handleSubmit(text: string): void {
    // Editor.submitValue() expands paste markers, trims, and clears the
    // buffer BEFORE invoking onSubmit — `text` is already the full message.
    const message = text.trim();
    if (message === "") return;
    this.editor.addToHistory(message);
    this.setHint("");
    this.onSubmit(message);
  }

  private handleGlobalKeys(
    data: string,
  ): { consume?: boolean; data?: string } | undefined {
    // Overlays, inline prompts (pause decisions), and selectors (pickers)
    // own their keys — including Esc and Ctrl+C, which SelectList/Input map
    // to cancel.
    if (this.tui.hasOverlay() || this.promptActive || this.selectorActive) {
      return undefined;
    }

    if (matchesKey(data, "escape")) {
      // Let the editor close its own autocomplete popup first.
      if (this.editor.isShowingAutocomplete()) return undefined;
      this.onInterrupt();
      return { consume: true };
    }

    if (matchesKey(data, "ctrl+c")) {
      const now = Date.now();
      if (this.editor.getText().length > 0) {
        this.editor.setText("");
        this.lastCtrlCAt = 0;
        this.tui.requestRender();
        return { consume: true };
      }
      if (now - this.lastCtrlCAt < CTRL_C_EXIT_WINDOW_MS) {
        void this.exit(0);
        return { consume: true };
      }
      this.lastCtrlCAt = now;
      this.setHint("Press Ctrl+C again to exit");
      return { consume: true };
    }

    return undefined;
  }
}
