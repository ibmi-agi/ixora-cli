// Manual TUI smoke for the chat shell (no AgentOS needed):
//   npx tsx scripts/chat-dev.ts
// Type text → echoed into the transcript. /exit or Ctrl+C twice exits.
// Verify the terminal is sane afterwards (stty -a unchanged, cursor visible).

import { buildChatTheme } from "../src/lib/chat/theme.js";
import { ChatApp } from "../src/lib/chat/app.js";
import { StyledLines } from "../src/lib/chat/components/blocks.js";
import { userMessageLine } from "../src/lib/chat/components/transcript-view.js";
import { parseSlash } from "../src/lib/chat/slash.js";

const theme = buildChatTheme();
const app = new ChatApp(theme);

app.onSubmit = (text) => {
  const slash = parseSlash(text);
  if (slash?.kind === "command" && slash.command === "exit") {
    void app.exit(0);
    return;
  }
  if (slash?.kind === "command" && slash.command === "clear") {
    app.clearTranscript();
    return;
  }
  app.addToTranscript(userMessageLine(theme, text));
  app.addToTranscript(new StyledLines(theme.dim(`echo: ${text}`)));
};
app.onInterrupt = () => {
  app.setHint("Esc pressed (interrupt) — nothing to cancel in dev mode");
};

app.setHeader("dev smoke · no backend");
app.setFooter("agent: dev-smoke · no backend", "↑0 ↓0");
app.start();
app.addToTranscript(
  new StyledLines(theme.dim("chat-dev: type to echo, /exit or Ctrl+C twice to quit.")),
);
app.requestRender();
