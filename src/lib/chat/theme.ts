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

export interface ChatTheme {
  // General styling
  dim: (s: string) => string;
  accent: (s: string) => string;
  error: (s: string) => string;
  success: (s: string) => string;
  warning: (s: string) => string;
  bold: (s: string) => string;
  /** "you>" label on submitted messages. */
  user: (s: string) => string;
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
