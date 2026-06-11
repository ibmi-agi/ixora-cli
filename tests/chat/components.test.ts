// Render-contract tests for the chat components: no rendered line may exceed
// the given width (pi-tui hard rule), in-place updates retitle/restyle, and
// TurnView projects reducer state (driven by the recorded fixtures).

import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildChatTheme } from "../../src/lib/chat/theme.js";
import {
  MemberBlockView,
  MetricsFooter,
  ReasoningLane,
  StyledLines,
  ToolCallRow,
} from "../../src/lib/chat/components/blocks.js";
import { TurnView } from "../../src/lib/chat/components/transcript-view.js";
import {
  createInitialState,
  finalizeTranscript,
  reduce,
  summarizeArgs,
} from "../../src/lib/chat/reducer.js";
import type {
  MemberBlock,
  ReasoningBlock,
  ToolBlock,
  TranscriptState,
} from "../../src/lib/chat/types.js";
import { replayFixture } from "./helpers.js";

const theme = buildChatTheme();

function toolBlock(overrides: Partial<ToolBlock> = {}): ToolBlock {
  const args = overrides.args ?? { query: "select 1" };
  return {
    id: "b1",
    kind: "tool",
    parentId: null,
    open: true,
    createdAtMs: 0,
    toolCallId: "tc-1",
    toolName: "run_sql",
    args,
    argsSummary: summarizeArgs(args),
    status: "running",
    result: null,
    durationSeconds: null,
    startedAtMs: 0,
    ...overrides,
  };
}

function assertWithinWidth(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("ToolCallRow", () => {
  it("never renders wider than the given width for pathological args", () => {
    const args = {
      sql: "select * from qsys2.syscolumns where table_name = 'X'".repeat(40),
      nested: { a: [1, 2, 3], b: "y".repeat(500) },
      flag: true,
    };
    const row = new ToolCallRow(theme, toolBlock({ args, argsSummary: summarizeArgs(args) }));
    for (const width of [10, 20, 40, 80, 200]) {
      assertWithinWidth(row.render(width), width);
    }
  });

  it("completes in place: glyph and duration change on update", () => {
    const row = new ToolCallRow(theme, toolBlock());
    const before = row.render(80).join("\n");
    expect(before).toContain("run_sql");
    row.update(
      toolBlock({ status: "success", durationSeconds: 1.234, result: "ok" }),
    );
    const after = row.render(80).join("\n");
    expect(after).toContain("1.2s");
    expect(after).not.toBe(before);
  });
});

describe("MemberBlockView", () => {
  function memberBlock(overrides: Partial<MemberBlock> = {}): MemberBlock {
    return {
      id: "m1",
      kind: "member",
      parentId: null,
      open: true,
      createdAtMs: 0,
      memberId: "member-one",
      name: "member-one",
      task: "do the thing",
      status: "running",
      delegationToolCallId: "tc-d1",
      ...overrides,
    };
  }

  it("retitles in place when the member RunStarted upgrade lands", () => {
    const view = new MemberBlockView(theme, memberBlock());
    expect(view.render(80)[0]).toContain("member-one");
    view.update(memberBlock({ name: "Agent One", memberId: "agent-one" }));
    expect(view.render(80)[0]).toContain("Agent One");
  });

  it("respects width for long member tasks", () => {
    const view = new MemberBlockView(
      theme,
      memberBlock({ task: "investigate ".repeat(50) }),
    );
    assertWithinWidth(view.render(40), 40);
  });
});

describe("ReasoningLane", () => {
  function reasoningBlock(overrides: Partial<ReasoningBlock> = {}): ReasoningBlock {
    return {
      id: "r1",
      kind: "reasoning",
      parentId: null,
      open: true,
      createdAtMs: 0,
      key: "run-1:reasoning",
      text: "thinking about things\nacross lines",
      ...overrides,
    };
  }

  it("shows text while open and collapses to a summary row when closed", () => {
    const lane = new ReasoningLane(theme, reasoningBlock());
    expect(lane.render(80).length).toBeGreaterThan(1);
    lane.update(reasoningBlock({ open: false }));
    const collapsed = lane.render(80);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toContain("reasoned");
  });
});

describe("MetricsFooter", () => {
  it("renders nothing without metrics and one line with them", () => {
    const footer = new MetricsFooter(theme);
    expect(footer.render(80)).toHaveLength(0);
    footer.setMetrics({ input_tokens: 10, output_tokens: 20, duration: 1.5 });
    const lines = footer.render(80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("tokens: 10/20");
    expect(lines[0]).toContain("time: 1.50s");
  });
});

describe("StyledLines", () => {
  it("wraps long content within width", () => {
    const block = new StyledLines("word ".repeat(100));
    assertWithinWidth(block.render(24), 24);
  });
});

describe("TurnView projection", () => {
  async function project(fixture: string): Promise<{
    view: TurnView;
    state: TranscriptState;
  }> {
    const events = await replayFixture(fixture);
    let state = createInitialState();
    const view = new TurnView(theme);
    for (const event of events) {
      state = reduce(state, event);
      view.sync(state);
    }
    state = finalizeTranscript(state);
    view.sync(state);
    return { view, state };
  }

  it("projects a simple run into markdown + metrics within width", async () => {
    const { view } = await project("simple-run");
    for (const width of [30, 80, 120]) {
      assertWithinWidth(view.container.render(width), width);
    }
    const rendered = view.container.render(120).join("\n");
    expect(rendered).toContain("tokens:");
  });

  it("projects a team run with member blocks indented inside", async () => {
    const { view, state } = await project("team-two-members");
    const rendered = view.container.render(120).join("\n");
    expect(rendered).toContain("Agent One");
    expect(rendered).toContain("Agent Two");
    expect(state.blocks.filter((b) => b.kind === "member")).toHaveLength(2);
    assertWithinWidth(view.container.render(60), 60);
  });

  it("projects workflow steps with titles and nested content", async () => {
    const { view } = await project("workflow-steps");
    const rendered = view.container.render(120).join("\n");
    expect(rendered).toContain("step");
    assertWithinWidth(view.container.render(50), 50);
  });

  it("renders an error banner for run-error", async () => {
    const { view } = await project("run-error");
    const rendered = view.container.render(120).join("\n");
    expect(rendered).toContain("Error:");
  });
});
