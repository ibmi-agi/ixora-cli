# Model Provider

Switch the AI model provider for your stack. Two commands:

```bash
ixora stack models show
ixora stack models set [provider]
```

> Not to be confused with `ixora models list`, which queries the **AgentOS server** for the models it can load. See [`../runtime/models.md`](../runtime/models.md).

---

## `models show`

Default subcommand. Displays the active provider and the two model strings used by ixora.

```bash
$ ixora stack models show

  Provider:       Anthropic
  Agent model:    anthropic:claude-sonnet-4-6
  Team model:     anthropic:claude-haiku-4-5
  API key var:    ANTHROPIC_API_KEY (set)

  Switch with:    ixora stack models set <provider>
```

Driven by `IXORA_AGENT_MODEL`, `IXORA_TEAM_MODEL`, and the provider-specific API key env var in `~/.ixora/.env`.

---

## `models set [provider]`

Interactive provider switcher. Prompts for a new key when needed.

```bash
ixora stack models set                  # interactive picker
ixora stack models set anthropic
ixora stack models set openai
ixora stack models set google
ixora stack models set ollama
ixora stack models set openai-compatible
ixora stack models set custom
```

Providers:

| Provider | Default agent model | Default team model | What it asks |
|---|---|---|---|
| `anthropic` | `claude-sonnet-4-6` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-4o` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `google` | `gemini-2.5-pro` | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| `ollama` | `llama3.1` | `llama3.1` | URL + model name; no key |
| `openai-compatible` | you choose | you choose | base URL + API key |
| `custom` | you choose | you choose | env var name for the key |

For Ollama, the picker also verifies connectivity to the URL before writing the change.

After switching:

```bash
ixora stack restart                     # API picks up the new env vars
```

---

## Manual override

You can set the keys directly without the picker:

```bash
ixora stack config set IXORA_AGENT_MODEL 'openai:gpt-4o'
ixora stack config set IXORA_TEAM_MODEL 'openai:gpt-4o-mini'
ixora stack config set OPENAI_API_KEY 'sk-...'
ixora stack restart
```

`models show` reads from these env vars, so the change is immediately reflected.

---

## See also

- [`../configuration.md`](../configuration.md) — `~/.ixora/.env` reference
- [`../runtime/models.md`](../runtime/models.md) — list models exposed by the AgentOS server
