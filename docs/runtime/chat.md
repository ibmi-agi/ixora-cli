# `ixora chat`

Interactive chat TUI for the targeted AgentOS — a full-screen REPL that streams agent, team, and workflow runs with live token output, tool-call rendering, and inline human-in-the-loop confirmations.

```bash
ixora chat                              # pick an entity interactively
ixora chat --agent sql-agent            # chat with one agent
ixora chat --team security-team         # chat with a team
ixora chat --workflow security-assessment
ixora chat --agent sql-agent --session chat_abc   # resume a session
ixora chat --agent sql-agent --bypass-confirmations
```

Where `agents run` is one command per message, `chat` keeps a conversation open: every message you type runs against the active entity in the same session, and the transcript stays on screen.

---

## TTY only

`chat` is a terminal UI — it owns both stdin and stdout. It requires an interactive terminal on **both**; piping either side refuses immediately:

```text
$ echo "hi" | ixora chat --agent sql-agent
Error: 'ixora chat' requires an interactive terminal. For scripted runs use `ixora agents run`.
```

(exit code 1). For scripts, CI, and agent automation use [`ixora agents run`](agents.md#run-agent_id-message) — it has `--stream`, `--background`, `--bypass-confirmations`, and JSON output.

Output flags don't apply: `chat` ignores `-o` and `--json` entirely. It does honor `--no-color` (and the `NO_COLOR` env var) for its own rendering.

---

## Flags

| Flag | Effect |
|---|---|
| `--agent <id>` | Chat with this agent. Mutually exclusive with `--team` / `--workflow`. |
| `--team <id>` | Chat with this team. Mutually exclusive with `--agent` / `--workflow`. |
| `--workflow <id>` | Run this workflow. Mutually exclusive with `--agent` / `--team`. |
| `--session <id>` | Resume an existing session — prior runs are loaded into the transcript. |
| `--bypass-confirmations` | Auto-approve confirmation-gated tools, so runs never pause (demo mode). |

The [global AgentOS-targeting flags](../global-options.md) (`--system`, `--url`, `--key`, `--timeout`, `--no-color`) all apply.

An unknown id passed via `--agent`/`--team`/`--workflow` exits 1 with a not-found error pointing at the discovery command (`ixora agents list`, `ixora teams list`, or `ixora workflows list`).

---

## Picking a system

`chat` resolves its AgentOS target with the [same order as every runtime command](README.md#targeting-a-system) (`--url` → `--system` → configured default → only available system) — with one difference: when 2+ systems are available and no default decides it, other runtime commands error, but `chat` **prompts you to pick one** (the configured default, if any, is listed first). Cancelling the prompt (Ctrl+C / Esc) exits quietly with code 130.

---

## The entity picker

Run `ixora chat` with no entity flag and a tabbed picker opens, listing the agents, teams, and workflows discovered on the server. Tab between the three kinds, pick one, and start typing. You can switch entities later without leaving chat via `/agents`, `/teams`, or `/workflows`.

---

## Slash commands

Type `/` at the start of the input line to autocomplete these:

| Command | Effect |
|---|---|
| `/agents [id]` | List agents, or switch the active agent |
| `/teams [id]` | List teams, or switch the active team |
| `/workflows [id]` | List workflows, or switch the active workflow |
| `/sessions [id]` | List sessions, or resume one |
| `/new` | Start a new session |
| `/clear` | Clear the screen and start a new session |
| `/system [id]` | Show or switch the target system |
| `/status` | Show system, entity, and session status |
| `/tools` | List the active entity's tools (confirmation-gated tools flagged) |
| `/help` | Show available commands |
| `/exit` | Exit chat |

---

## Layout

Submitted messages render on a full-width grey bar; tool calls render as tinted sections showing the call, the tail of its output, and its duration. A status bar under the input line shows the connected entity and system on the left, and the session's token totals (`↑input ↓output`) plus the model on the right.

---

## Key bindings

| Key | Effect |
|---|---|
| `Enter` | Send the message |
| `Esc` | Cancel the in-flight run (aborts the stream and cancels it server-side) — does not exit chat |
| `Ctrl+C` | Clear the input line; pressed twice within 1s, exit chat |

---

## Tool confirmations (HITL)

When a run pauses on a confirmation-gated tool (the same pauses described in [`agents.md`](agents.md#when-the-agent-pauses-for-approval)), `chat` shows an inline prompt above the input line — the transcript stays visible — with the tool name and arguments (long argument payloads are truncated to a preview) and prompts per tool:

- **Approve** — run the tool.
- **Reject** — don't run it.
- **Reject with note** — don't run it, and tell the agent why (the note becomes `confirmation_note`).
- **Approve all** — approve this and every remaining tool in the pause (multi-tool pauses only).

Rejected tools still **inform the agent**: the run always continues with the decision stamped (`confirmed: false` plus the note), so the agent sees the rejection and adapts instead of the run stranding paused. With `--bypass-confirmations` every gated tool is approved automatically and no prompt appears.

---

## Sessions

Each chat threads its runs through one session, so the entity keeps conversation context across messages.

- `--session <id>` resumes a session at startup, replaying its prior runs into the transcript.
- `/new` starts a fresh session mid-chat.
- `/sessions` lists existing sessions; `/sessions <id>` resumes one.
- `/status` shows the current session id (for later `ixora sessions runs <id>` inspection).

---

## Teams and workflows

- **Teams** stream with **member blocks** — each delegated member's content and tool calls render attributed under that member. Tool confirmations are **not available for team runs**: the AgentOS streaming protocol does not emit pause events for teams (protocol limitation). Confirmation-gated tools on team members should be exercised via a direct agent chat, or bypassed.
- **Workflows** are single-shot: each message starts a workflow run, rendered step by step (step started / output / completed). There is no conversational threading between workflow runs.

---

## See also

- [`agents.md`](agents.md) — `agents run` (the scriptable counterpart), `--interactive`, pause/continue mechanics
- [`teams.md`](teams.md), [`workflows.md`](workflows.md) — the underlying run commands
- [`sessions.md`](sessions.md) — manage the sessions chat creates
- [`../global-options.md`](../global-options.md) — system targeting flags
