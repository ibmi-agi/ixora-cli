// pi-style selector tests: pickers mount through a SelectorHost (in the
// editor's place, not an overlay), the search Input buffers printable keys,
// and navigation keys drive the SelectList.

import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildChatTheme } from "../../src/lib/chat/theme.js";
import {
  showEntityPicker,
  showListPicker,
  type EntityLists,
  type SelectorHost,
} from "../../src/lib/chat/components/pickers.js";
import type { PromptComponent } from "../../src/lib/chat/app.js";

const theme = buildChatTheme();

const ENTER = "\r";
const ESC = "\x1b";
const TAB = "\t";
const ARROW_DOWN = "\x1b[B";

const ENTITIES: EntityLists = {
  agents: [
    { value: "ibmi-agent", label: "IBM i Agent", description: "main agent" },
    { value: "hello-ops", label: "Hello Ops", description: "demo agent" },
  ],
  teams: [{ value: "ibmi-team", label: "IBM i Team", description: "the team" }],
  workflows: [],
};

class FakeHost implements SelectorHost {
  selectors: PromptComponent[] = [];
  dismissed = 0;

  presentSelector(component: PromptComponent): void {
    this.selectors.push(component);
  }

  dismissSelector(): void {
    this.dismissed += 1;
  }

  current(): PromptComponent {
    const selector = this.selectors[this.selectors.length - 1];
    if (!selector) throw new Error("no selector presented");
    return selector;
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("showEntityPicker (pi-style selector)", () => {
  it("Enter picks the highlighted entity and dismisses", async () => {
    const host = new FakeHost();
    const pick = showEntityPicker(host, theme, ENTITIES, "agent");
    await settle();
    host.current().handleInput(ENTER);
    expect(await pick).toEqual({ kind: "agent", id: "ibmi-agent", name: "IBM i Agent" });
    expect(host.dismissed).toBe(1);
  });

  it("arrows move the selection before Enter", async () => {
    const host = new FakeHost();
    const pick = showEntityPicker(host, theme, ENTITIES, "agent");
    await settle();
    host.current().handleInput(ARROW_DOWN);
    host.current().handleInput(ENTER);
    expect(await pick).toEqual({ kind: "agent", id: "hello-ops", name: "Hello Ops" });
  });

  it("Tab switches the entity kind", async () => {
    const host = new FakeHost();
    const pick = showEntityPicker(host, theme, ENTITIES, "agent");
    await settle();
    host.current().handleInput(TAB);
    host.current().handleInput(ENTER);
    expect(await pick).toEqual({ kind: "team", id: "ibmi-team", name: "IBM i Team" });
  });

  it("typed characters filter the list through the search input", async () => {
    const host = new FakeHost();
    const pick = showEntityPicker(host, theme, ENTITIES, "agent");
    await settle();
    for (const ch of "hello") host.current().handleInput(ch);
    expect(host.current().render(80).join("\n")).toContain("> hello");
    host.current().handleInput(ENTER);
    expect(await pick).toEqual({ kind: "agent", id: "hello-ops", name: "Hello Ops" });
  });

  it("Esc cancels with null", async () => {
    const host = new FakeHost();
    const pick = showEntityPicker(host, theme, ENTITIES, "agent");
    await settle();
    host.current().handleInput(ESC);
    expect(await pick).toBeNull();
    expect(host.dismissed).toBe(1);
  });

  it("renders rules, tabs, hint, and stays within width", async () => {
    const host = new FakeHost();
    const pick = showEntityPicker(host, theme, ENTITIES, "agent");
    await settle();
    const lines = host.current().render(60);
    const rendered = lines.join("\n");
    expect(rendered).toContain("Agents");
    expect(rendered).toContain("─".repeat(60));
    expect(rendered).toContain("Type to search");
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    }
    host.current().handleInput(ESC);
    await pick;
  });
});

describe("showListPicker (pi-style selector)", () => {
  const ITEMS = [
    { value: "s1", label: "session one", description: "2026-06-10" },
    { value: "s2", label: "session two", description: "2026-06-11" },
  ];

  it("selects an item and resolves it", async () => {
    const host = new FakeHost();
    const pick = showListPicker(host, theme, "Resume session", ITEMS);
    await settle();
    host.current().handleInput(ARROW_DOWN);
    host.current().handleInput(ENTER);
    expect(await pick).toMatchObject({ value: "s2" });
    expect(host.dismissed).toBe(1);
  });

  it("filters via typed search and cancels on Esc", async () => {
    const host = new FakeHost();
    const pick = showListPicker(host, theme, "Resume session", ITEMS);
    await settle();
    for (const ch of "two") host.current().handleInput(ch);
    expect(host.current().render(80).join("\n")).toContain("> two");
    host.current().handleInput(ESC);
    expect(await pick).toBeNull();
  });

  it("shows the title in the context row", async () => {
    const host = new FakeHost();
    const pick = showListPicker(host, theme, "Switch system", ITEMS);
    await settle();
    expect(host.current().render(80).join("\n")).toContain("Switch system");
    host.current().handleInput(ESC);
    await pick;
  });
});
