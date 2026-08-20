# @max-null/dsh-draft-polish

A **draft polish** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a ✨ button left of the send button that calls an LLM to polish your draft, then writes the result back into the composer.

> Evolved from the **Fractal (OC desktop shell)** implementation: OC's serve concurrency bugs made polishing impossible while a session was still generating; DSH's `llm` capability is decoupled from session scheduling, so **polishing works mid-generation** — and it can carry the **current conversation context** to help the model understand your intent (the dsh-sidebar-qa ask-with-context mechanism).

## Features

| Capability | Description |
|---|---|
| **One-click polish** | ✨ button left of the send button; result replaces the draft |
| **Works mid-generation** | Uses the DSH `llm` channel, decoupled from agent-session scheduling |
| **Conversation context** | By default the last 4 messages are attached as background context (configurable, can be disabled) |
| **Reuses existing model channel** | No separate API key; inherits the current session's channel, or set provider/model explicitly |
| **Zero pollution** | No session created, no history written — only the draft changes |
| **Per-session isolation** | Each session's composer is independent; switching sessions mid-polish still writes back to the originating one |

## Install

```bash
dsh plugin --profile <name> add @max-null/dsh-draft-polish
```

Or add to the profile's `package.json` dependencies + `dsh.profile.bundles`:

```yaml
- id: draft-polish
  name: '@max-null/dsh-draft-polish'
```

## Usage

1. Write a draft in the composer;
2. Click the ✨ button left of the send button (no-op when empty);
3. The polished text replaces the draft automatically (spinner while working);
4. Review and send as usual.

### Settings

Settings page → "Polish" (or the `draft-polish` settings namespace): provider/model channel, `contextEnabled`, `recentWindowMessages` (verbatim recent window), `backgroundEnabled`/`backgroundWindowMessages` (optional fast-model background compression), `temperature`, `timeoutMs`.

## Architecture

- **Host half** (`lib/index.js`): `/draft-polish/api` routes (same trust fence as the /api gateway) — `sessionQuery.readSurface` reads the session context → `llm.stream` polishes (DSH channel, independent of session scheduling) → returns the text; the `draft-polish` settings namespace.
- **Client half** (`lib/client.js`): registers in the `conversation.input.right` slot (the official "before the send button" seat) — reads the draft (owner props) → fetches the host → writes back via the standard-kit `inputActions.setDraft`; registers a `settings.section` form.
- Context strategy inherits dsh-sidebar-qa: verbatim recent window (anchors the latest state) + optional compressed background (≤3 sentences), newest-first; any failure degrades to context-free polishing.

## Development

```bash
pnpm install
pnpm typecheck   # strict tsc
pnpm test        # vitest (host pure functions + component)
pnpm build       # tsdown → lib/
```

## SSID Family

This plugin belongs to the **`@max-null/*` family** — a set of plugins that together form the **[SSID (思灵 · Seek Soul in Darkness)](https://github.com/Max-Null/seek-soul-in-darkness)** desktop experience.

## License

MIT
