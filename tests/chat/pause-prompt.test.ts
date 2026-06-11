// Inline pause-prompt tests: the decision component mounts through a
// PromptHost (NOT a fullscreen overlay), keyboard drives the select list /
// note input directly, and big args are capped to a preview.

import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildChatTheme } from "../../src/lib/chat/theme.js";
import {
  promptPauseDecision,
  type PromptHost,
} from "../../src/lib/chat/components/pause-prompt.js";
import type { PromptComponent } from "../../src/lib/chat/app.js";
import type { ToolExecution } from "../../src/lib/chat/hitl.js";

const theme = buildChatTheme();

const ENTER = "\r";
const ESC = "\x1b";
const ARROW_DOWN = "\x1b[B";

function toolExecution(args: Record<string, unknown> = { sql: "select 1" }): ToolExecution {
  return {
    tool_call_id: "tc-1",
    tool_name: "execute_sql",
    tool_args: args,
    requires_confirmation: true,
    confirmed: null,
    confirmation_note: null,
  };
}

/** Captures presented prompts so tests can drive them with key data. */
class FakeHost implements PromptHost {
  prompts: PromptComponent[] = [];
  dismissed = 0;

  presentPrompt(component: PromptComponent): void {
    this.prompts.push(component);
  }

  dismissPrompt(): void {
    this.dismissed += 1;
  }

  current(): PromptComponent {
    const prompt = this.prompts[this.prompts.length - 1];
    if (!prompt) throw new Error("no prompt presented");
    return prompt;
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("promptPauseDecision (inline)", () => {
  it("Enter approves and dismisses the prompt", async () => {
    const host = new FakeHost();
    const decision = promptPauseDecision(host, theme, toolExecution(), false);
    await settle();
    expect(host.prompts).toHaveLength(1);
    host.current().handleInput(ENTER);
    expect(await decision).toEqual({ kind: "approve" });
    expect(host.dismissed).toBe(1);
  });

  it("Esc rejects (the safe default)", async () => {
    const host = new FakeHost();
    const decision = promptPauseDecision(host, theme, toolExecution(), false);
    await settle();
    host.current().handleInput(ESC);
    expect(await decision).toEqual({ kind: "reject" });
  });

  it("reject-with-note swaps to an inline note input", async () => {
    const host = new FakeHost();
    const decision = promptPauseDecision(host, theme, toolExecution(), false);
    await settle();
    // Approve · Reject · Reject with note — move down twice, confirm.
    host.current().handleInput(ARROW_DOWN);
    host.current().handleInput(ARROW_DOWN);
    host.current().handleInput(ENTER);
    await settle();
    expect(host.prompts).toHaveLength(2);
    for (const ch of "too risky") host.current().handleInput(ch);
    host.current().handleInput(ENTER);
    expect(await decision).toEqual({ kind: "reject", note: "too risky" });
    expect(host.dismissed).toBe(2);
  });

  it("offers Approve all only for multi-tool pauses", async () => {
    const host = new FakeHost();
    const decision = promptPauseDecision(host, theme, toolExecution(), true);
    await settle();
    expect(host.current().render(100).join("\n")).toContain("Approve all");
    host.current().handleInput(ESC);
    await decision;
  });

  it("caps huge args to a preview and stays within width", async () => {
    const host = new FakeHost();
    const args = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`key_${i}`, "v".repeat(120)]),
    );
    const decision = promptPauseDecision(host, theme, toolExecution(args), false);
    await settle();
    const lines = host.current().render(80);
    expect(lines.join("\n")).toContain("more lines");
    // title + capped args + marker + spacer + 3 list rows: well under a screen.
    expect(lines.length).toBeLessThanOrEqual(20);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
    host.current().handleInput(ESC);
    await decision;
  });
});
