// Chat theme: every pi-tui theme surface built from chalk.
//
// pi-tui is bring-your-own-color — all theme fields are plain
// `(s: string) => string` functions. chalk v5 freezes its color level at
// import time, so `--no-color` must set `chalk.level = 0` explicitly (the
// env-var-based handleNoColorFlag cannot work mid-process); call
// applyColorMode() BEFORE building the theme or any output.

import chalk from "chalk";
import type {
  DefaultTextStyle,
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@earendil-works/pi-tui";

/**
 * Honor --no-color / NO_COLOR for the chat TUI. Commander negates --no-color
 * into opts.color === false; NO_COLOR is already respected by chalk at import
 * time, so only the flag needs handling here.
 */
export function applyColorMode(colorEnabled: boolean): void {
  if (!colorEnabled) {
    chalk.level = 0;
  }
}

/**
 * Full-width background bar (pi-style), as a raw SGR open/close pair rather
 * than a chalk function: bar lines can contain `\x1b[0m` resets injected by
 * truncateToWidth, and the renderer must re-open the background after each
 * one — impossible through an opaque chalk wrapper.
 */
export interface BarStyle {
  open: string;
  close: string;
}

export interface ChatTheme {
  // General styling
  dim: (s: string) => string;
  accent: (s: string) => string;
  error: (s: string) => string;
  success: (s: string) => string;
  warning: (s: string) => string;
  bold: (s: string) => string;
  /** "you>" label on submitted messages (no-color fallback). */
  user: (s: string) => string;
  /** Grey full-width bar behind submitted user messages (null = no color). */
  userBar: BarStyle | null;
  /** Tinted full-width bar behind tool-call sections (null = no color). */
  toolBar: BarStyle | null;
  /** Member-block titles (delegated team members). */
  member: (s: string) => string;
  /** Workflow step/group titles. */
  step: (s: string) => string;

  // pi-tui component themes
  editor: EditorTheme;
  selectList: SelectListTheme;
  markdown: MarkdownTheme;
  /** Reasoning lane rendered as dim italic markdown. */
  reasoningStyle: DefaultTextStyle;
}

/**
 * Background bar for the current chalk level: truecolor when available,
 * a 256-color approximation otherwise, none when colors are off (level <= 1 —
 * 16-color terminals have no usable subtle background).
 */
function buildBar(
  rgb: [number, number, number],
  ansi256: number,
): BarStyle | null {
  if (chalk.level >= 3) {
    return { open: `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`, close: "\x1b[49m" };
  }
  if (chalk.level === 2) {
    return { open: `\x1b[48;5;${ansi256}m`, close: "\x1b[49m" };
  }
  return null;
}

function buildSelectListTheme(): SelectListTheme {
  return {
    selectedPrefix: (s) => chalk.cyan(s),
    selectedText: (s) => chalk.cyan(s),
    description: (s) => chalk.dim(s),
    scrollInfo: (s) => chalk.dim(s),
    noMatch: (s) => chalk.dim(s),
  };
}

function buildMarkdownTheme(): MarkdownTheme {
  return {
    heading: (s) => chalk.bold.cyan(s),
    link: (s) => chalk.underline.blue(s),
    linkUrl: (s) => chalk.dim(s),
    code: (s) => chalk.yellow(s),
    codeBlock: (s) => chalk.yellow(s),
    codeBlockBorder: (s) => chalk.dim(s),
    quote: (s) => chalk.dim.italic(s),
    quoteBorder: (s) => chalk.dim(s),
    hr: (s) => chalk.dim(s),
    listBullet: (s) => chalk.cyan(s),
    bold: (s) => chalk.bold(s),
    italic: (s) => chalk.italic(s),
    strikethrough: (s) => chalk.strikethrough(s),
    underline: (s) => chalk.underline(s),
  };
}

export function buildChatTheme(): ChatTheme {
  const selectList = buildSelectListTheme();
  return {
    dim: (s) => chalk.dim(s),
    accent: (s) => chalk.cyan(s),
    error: (s) => chalk.red(s),
    success: (s) => chalk.green(s),
    warning: (s) => chalk.yellow(s),
    bold: (s) => chalk.bold(s),
    user: (s) => chalk.bold.green(s),
    // Slate grey (pi's user-message bar) / dark desaturated green (tool bar).
    userBar: buildBar([43, 48, 59], 237),
    toolBar: buildBar([30, 41, 30], 235),
    member: (s) => chalk.magenta(s),
    step: (s) => chalk.blue(s),
    editor: {
      borderColor: (s) => chalk.dim(s),
      selectList,
    },
    selectList,
    markdown: buildMarkdownTheme(),
    reasoningStyle: { color: (s) => chalk.dim(s), italic: true },
  };
}
