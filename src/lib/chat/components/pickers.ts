// pi-style selectors: tabbed entity picker, plus a generic list picker used
// for sessions and systems.
//
// Selectors mount IN PLACE of the editor (SelectorHost.presentSelector) —
// never as centered overlays — mirroring pi's settings/model selectors:
// ─ rule · context row · "> " search input · list (→ cursor, n/total) ·
// dim hint · ─ rule. The search Input buffers printable keys; navigation
// keys (up/down/enter/Esc) route to the SelectList. Every picker is created
// fresh by its factory and never reused; factories resolve null on cancel
// (Esc / Ctrl+C).

import {
  Container,
  Input,
  SelectList,
  Text,
  matchesKey,
  type Component,
  type SelectItem,
} from "@earendil-works/pi-tui";
import type { ChatTheme } from "../theme.js";
import type { PromptComponent } from "../app.js";

/** Where selectors mount; ChatShell satisfies this structurally. */
export interface SelectorHost {
  presentSelector(component: PromptComponent): void;
  dismissSelector(): void;
}

export type EntityKind = "agent" | "team" | "workflow";

export interface EntityChoice {
  kind: EntityKind;
  id: string;
  name: string;
}

export interface EntityLists {
  agents: SelectItem[];
  teams: SelectItem[];
  workflows: SelectItem[];
}

const TABS: { kind: EntityKind; label: string; key: keyof EntityLists }[] = [
  { kind: "agent", label: "Agents", key: "agents" },
  { kind: "team", label: "Teams", key: "teams" },
  { kind: "workflow", label: "Workflows", key: "workflows" },
];

const MAX_VISIBLE = 10;

/** Full-width horizontal rule (pi's DynamicBorder). */
class Rule implements Component {
  constructor(private readonly color: (s: string) => string) {}

  render(width: number): string[] {
    return [this.color("─".repeat(Math.max(1, width)))];
  }

  invalidate(): void {}
}

/** Navigation keys belong to the list; everything else feeds the search. */
function isListKey(data: string): boolean {
  return (
    matchesKey(data, "up") ||
    matchesKey(data, "down") ||
    matchesKey(data, "pageUp") ||
    matchesKey(data, "pageDown") ||
    matchesKey(data, "enter") ||
    matchesKey(data, "escape") ||
    matchesKey(data, "ctrl+c")
  );
}

/**
 * Shared selector scaffolding: rule · context row · search input · list ·
 * hint · rule, with focus propagated into the Input so its cursor shows.
 */
abstract class SelectorComponent extends Container {
  private _focused = false;
  protected readonly input = new Input();
  protected readonly contextLine = new Text("", 1, 0);
  protected readonly listSlot = new Container();

  constructor(theme: ChatTheme, hint: string) {
    super();
    this.addChild(new Rule(theme.dim));
    this.addChild(this.contextLine);
    this.addChild(this.input);
    this.addChild(this.listSlot);
    this.addChild(new Text(theme.dim(hint), 1, 0));
    this.addChild(new Rule(theme.dim));
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  handleInput(data: string): void {
    if (this.handleExtraKeys(data)) return;
    if (isListKey(data)) {
      this.activeList().handleInput(data);
      return;
    }
    this.input.handleInput(data);
    this.applyFilter(this.input.getValue());
  }

  /** Picker-specific keys (e.g. Tab). Return true when consumed. */
  protected handleExtraKeys(data: string): boolean {
    void data;
    return false;
  }

  protected abstract activeList(): SelectList;

  protected abstract applyFilter(filter: string): void;
}

class EntityPickerComponent extends SelectorComponent {
  private tabIndex: number;
  private readonly lists: SelectList[];

  constructor(
    private readonly theme: ChatTheme,
    entities: EntityLists,
    initialTab: EntityKind,
    private readonly done: (choice: EntityChoice | null) => void,
  ) {
    super(theme, "Type to search · Tab to switch kind · Enter to select · Esc to cancel");
    this.tabIndex = Math.max(
      0,
      TABS.findIndex((t) => t.kind === initialTab),
    );
    this.lists = TABS.map((tab) => {
      const list = new SelectList(entities[tab.key], MAX_VISIBLE, theme.selectList);
      list.onSelect = (item) => {
        this.done({ kind: tab.kind, id: item.value, name: item.label });
      };
      list.onCancel = () => this.done(null);
      return list;
    });
    this.refresh();
  }

  protected override handleExtraKeys(data: string): boolean {
    if (!matchesKey(data, "tab")) return false;
    this.tabIndex = (this.tabIndex + 1) % TABS.length;
    this.input.setValue("");
    this.refresh();
    return true;
  }

  protected activeList(): SelectList {
    return this.lists[this.tabIndex];
  }

  protected applyFilter(filter: string): void {
    this.activeList().setFilter(filter);
  }

  private refresh(): void {
    const t = this.theme;
    this.contextLine.setText(
      TABS.map((tab, i) =>
        i === this.tabIndex
          ? t.accent(t.bold(` ${tab.label} `))
          : t.dim(` ${tab.label} `),
      ).join(t.dim("|")),
    );
    const active = this.activeList();
    active.setFilter(this.input.getValue());
    this.listSlot.clear();
    this.listSlot.addChild(active);
  }
}

/**
 * Tabbed Agents | Teams | Workflows picker, in the editor's place. Resolves
 * the chosen entity, or null on cancel.
 */
export function showEntityPicker(
  host: SelectorHost,
  theme: ChatTheme,
  entities: EntityLists,
  initialTab: EntityKind = "agent",
): Promise<EntityChoice | null> {
  return new Promise((resolve) => {
    let settled = false;
    const component = new EntityPickerComponent(
      theme,
      entities,
      initialTab,
      (choice) => {
        if (settled) return;
        settled = true;
        host.dismissSelector();
        resolve(choice);
      },
    );
    host.presentSelector(component);
  });
}

class ListPickerComponent extends SelectorComponent {
  private readonly list: SelectList;

  constructor(
    theme: ChatTheme,
    title: string,
    items: SelectItem[],
    done: (item: SelectItem | null) => void,
  ) {
    super(theme, "Type to search · Enter to select · Esc to cancel");
    this.contextLine.setText(theme.bold(title));
    this.list = new SelectList(items, MAX_VISIBLE, theme.selectList);
    this.list.onSelect = (item) => done(item);
    this.list.onCancel = () => done(null);
    this.listSlot.addChild(this.list);
  }

  protected activeList(): SelectList {
    return this.list;
  }

  protected applyFilter(filter: string): void {
    this.list.setFilter(filter);
  }
}

/** Generic single-list picker (sessions, systems, ...), in the editor's place. */
export function showListPicker(
  host: SelectorHost,
  theme: ChatTheme,
  title: string,
  items: SelectItem[],
): Promise<SelectItem | null> {
  return new Promise((resolve) => {
    let settled = false;
    const component = new ListPickerComponent(theme, title, items, (item) => {
      if (settled) return;
      settled = true;
      host.dismissSelector();
      resolve(item);
    });
    host.presentSelector(component);
  });
}

export type { SelectItem };
