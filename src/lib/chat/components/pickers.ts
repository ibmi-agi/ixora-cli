// Overlay pickers: tabbed entity picker, plus a generic list picker used for
// sessions and systems.
//
// Overlay lifecycle rule (pi-tui): overlay components are disposed on hide —
// every picker is created fresh by its factory and never reused. All
// factories resolve null on cancel (Esc / Ctrl+C).

import {
  Container,
  SelectList,
  Text,
  decodeKittyPrintable,
  matchesKey,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import type { ChatTheme } from "../theme.js";

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

/** Extract a typed printable character from one key event, if any. */
function printableChar(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if (data.length === 1 && data >= " " && data !== "\x7f") return data;
  return undefined;
}

const MAX_VISIBLE = 10;

class EntityPickerComponent extends Container {
  private tabIndex: number;
  private filter = "";
  private readonly lists: SelectList[];
  private readonly tabsLine = new Text("", 1, 0);
  private readonly filterLine = new Text("", 1, 0);
  private readonly listSlot = new Container();

  constructor(
    private readonly theme: ChatTheme,
    private readonly entities: EntityLists,
    initialTab: EntityKind,
    private readonly done: (choice: EntityChoice | null) => void,
  ) {
    super();
    this.tabIndex = Math.max(
      0,
      TABS.findIndex((t) => t.kind === initialTab),
    );
    this.lists = TABS.map((tab) => {
      const list = new SelectList(
        this.entities[tab.key],
        MAX_VISIBLE,
        theme.selectList,
      );
      list.onSelect = (item) => {
        this.done({ kind: tab.kind, id: item.value, name: item.label });
      };
      list.onCancel = () => this.done(null);
      return list;
    });
    this.addChild(this.tabsLine);
    this.addChild(this.filterLine);
    this.addChild(this.listSlot);
    this.refresh();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "tab")) {
      this.tabIndex = (this.tabIndex + 1) % TABS.length;
      this.filter = "";
      this.refresh();
      return;
    }
    if (matchesKey(data, "backspace")) {
      if (this.filter.length > 0) {
        this.filter = this.filter.slice(0, -1);
        this.refresh();
        return;
      }
      // fall through: list ignores it
    }
    const ch = printableChar(data);
    if (ch !== undefined) {
      this.filter += ch;
      this.refresh();
      return;
    }
    this.lists[this.tabIndex].handleInput(data);
  }

  private refresh(): void {
    const t = this.theme;
    this.tabsLine.setText(
      TABS.map((tab, i) =>
        i === this.tabIndex
          ? t.accent(t.bold(` ${tab.label} `))
          : t.dim(` ${tab.label} `),
      ).join(t.dim("|")) + t.dim("   (Tab to switch, type to filter)"),
    );
    this.filterLine.setText(
      this.filter === "" ? "" : t.dim(`filter: ${this.filter}`),
    );
    const active = this.lists[this.tabIndex];
    active.setFilter(this.filter);
    this.listSlot.clear();
    this.listSlot.addChild(active);
  }
}

/**
 * Tabbed Agents | Teams | Workflows picker. Resolves the chosen entity, or
 * null on cancel.
 */
export function showEntityPicker(
  tui: TUI,
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
        tui.hideOverlay();
        resolve(choice);
        tui.requestRender();
      },
    );
    tui.showOverlay(component, { width: "70%", maxHeight: "70%" });
    tui.requestRender();
  });
}

class ListPickerComponent extends Container {
  private filter = "";
  private readonly list: SelectList;
  private readonly titleLine = new Text("", 1, 0);

  constructor(
    private readonly theme: ChatTheme,
    private readonly titleText: string,
    items: SelectItem[],
    done: (item: SelectItem | null) => void,
  ) {
    super();
    this.list = new SelectList(items, MAX_VISIBLE, theme.selectList);
    this.list.onSelect = (item) => done(item);
    this.list.onCancel = () => done(null);
    this.addChild(this.titleLine);
    this.addChild(this.list);
    this.refresh();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "backspace") && this.filter.length > 0) {
      this.filter = this.filter.slice(0, -1);
      this.refresh();
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined) {
      this.filter += ch;
      this.refresh();
      return;
    }
    this.list.handleInput(data);
  }

  private refresh(): void {
    const t = this.theme;
    const filter = this.filter === "" ? "" : t.dim(`  filter: ${this.filter}`);
    this.titleLine.setText(t.bold(this.titleText) + filter);
    this.list.setFilter(this.filter);
  }
}

/** Generic framed single-list overlay picker (sessions, systems, ...). */
export function showListPicker(
  tui: TUI,
  theme: ChatTheme,
  title: string,
  items: SelectItem[],
): Promise<SelectItem | null> {
  return new Promise((resolve) => {
    let settled = false;
    const component = new ListPickerComponent(theme, title, items, (item) => {
      if (settled) return;
      settled = true;
      tui.hideOverlay();
      resolve(item);
      tui.requestRender();
    });
    tui.showOverlay(component, { width: "70%", maxHeight: "70%" });
    tui.requestRender();
  });
}

export type { SelectItem };
