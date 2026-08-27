# PICOBU

An autonomous coding agent that lives in your terminal. Built with [OpenTUI](https://git.new/create-tui) and the Vercel AI SDK.

Type a prompt and the agent reads, plans, and edits your project step by step — with tool calls rendered live, per-run token/cost metrics, and a dark/light theme picker. An in-flight run keeps going even while you browse the home page.

## Requirements

- [Bun](https://bun.sh) ≥ 1.x

## Getting started

```bash
bun install   # install dependencies
bun dev       # run the TUI
```

Type-check with `bun run tsc`.

## Configuration

Everything lives in `~/.picobu/options.json` (auto-created as `{}` on first run). Three top-level blocks:

| Key | Purpose |
| --- | --- |
| `providers` | AI providers and their models, billing, and capabilities |
| `harness` | `defaultModel` (`"<providerId>/<modelId>"`) plus per-role model/thinking overrides |
| `theme` | Persisted theme choice (`key`, `variant`) — defaults to `{ "key": "tacos", "variant": "dark" }` |

Supported provider `type` values: `anthropic`, `openai-compatible`, `openai-responses`. API keys may be referenced from the environment with `"env:VAR_NAME"`.

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "env:ANTHROPIC_API_KEY",
      "models": [
        {
          "id": "claude-sonnet-4-5",
          "name": "Claude Sonnet 4.5",
          "context": 200000,
          "output": 64000,
          "reasoning": true,
          "efforts": ["none", "low", "medium", "high"],
          "defaultEffort": "medium",
          "supports": ["text", "vision"],
          "billing": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
        }
      ]
    }
  ],
  "harness": {
    "defaultModel": "anthropic/claude-sonnet-4-5",
    "modelRoles": {
      "tiny": "anthropic/claude-haiku-4-5",
      "flash": "anthropic/claude-sonnet-4-5",
      "flashThinking": "medium",
      "heavy": "anthropic/claude-opus-4-5",
      "heavyThinkingLevel": "high"
    }
  }
}
```

### Model roles

Agents run on three model roles, each with its own default thinking level:

| Role | Purpose | Default thinking |
| --- | --- | --- |
| `tiny` | fast, cheap lookups | `none` |
| `flash` | default workhorse (ask + coder agents) | model's `defaultEffort` |
| `heavy` | deep reasoning (plan-code agent) | model's `defaultEffort` (`heavyThinkingLevel` → `high`) |

## Usage

| Key | Action |
| --- | --- |
| `return` | Submit the prompt / start a run |
| `shift+return` | New line in the prompt |
| `tab` | Cycle agents: ask → coder → plan-code |
| `shift+tab` | Cycle thinking levels: none → low → medium → high → xhigh → max |
| `ctrl+m` | Open the model picker |
| `/` | Live command palette (fuzzy list of system + discovered commands) |
| `esc` | Close an open picker |
| `ctrl+c` | Exit (prints a resume hint) |

While the agent is streaming, all keys are swallowed so the run can't be interrupted mid-step.

### Slash commands

- `/models` — open the model picker (same as `ctrl+m`)
- `/effort [level]` — set thinking effort directly (`/effort high`) or open the picker
- `/quit` — graceful exit

Commands are also discovered from markdown files in `.agents/skills`, `.agents/workflows`, `.agents/prompts`, and `.agents/commands` — checked in your project, `~/.picobu`, and home, in that precedence order.

## Agents

| Agent | Role |
| --- | --- |
| `ask` | Fast Q&A, runs on the `flash` role |
| `coder` | The default coding loop, runs on the `flash` role |
| `plan-code` | Deep planning + implementation, runs on the `heavy` role |

## Tools

The agent gets six filesystem tools:

- `read` / `write` / `edit` — file I/O with diffs
- `glob` / `grep` — search (ripgrep-backed)
- `bash` — shell execution (uses your detected shell)

Every tool carries a JSON Schema rendered into the system prompt, and calls are rendered live in the chat as expandable tool cards.

## Themes

32 themes are bundled (aura, ayu, carbonfox, catppuccin variants, dracula, gruvbox, monokai, nord, tokyonight, zenburn, tacos, and more). Switch with the mouse in the header bar: click the theme name or arrows to cycle, and click the variant label to toggle dark/light. Your choice persists across launches.

## Project layout

```
src/
├── components/        # UI: header/footer, chat messages, tool-call cards, pickers, theme switcher
├── harness/           # Agent runtime: providers, agent factory, loop, prompts, toolset, commands
├── hooks/             # Run metrics, git status, keybinds, completion notifications
├── libs/              # options, lock, shell, notify, text stats, filetype
├── pages/             # CodingPage (chat) and SplashPage (home)
├── stores/            # XState stores: loop, theme, coding
└── themes/            # Theme definitions + 32 JSON color assets
```

## Tech stack

[OpenTUI](https://git.new/create-tui) · Vercel AI SDK (`ai`, `@ai-sdk/*`) · XState Store · Zod · Bun

This project was scaffolded with `bun create tui` — the easiest way to get started with OpenTUI.