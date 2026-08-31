# PICOBU

An autonomous coding agent that lives in your terminal. Built with [OpenTUI](https://git.new/create-tui) and the Vercel AI SDK.

Type a prompt and the agent reads, plans, and edits your project step by step — with tool calls rendered live, per-run token/cost metrics, and a dark/light theme picker. An in-flight run keeps going even while you browse the home page.

## Requirements

- [Bun](https://bun.sh) ≥ 1.x

## Getting started

```bash
bun install   # install dependencies
bun dev       # run the TUI
bun run web   # serve in the browser via xterm.js

# The same entry point is exposed as a CLI:
picobu                # run the TUI
picobu --web          # serve in the browser via xterm.js
picobu sessions       # list saved sessions for the current folder
picobu --session <id> # resume a saved session

```

Type-check with `bun run tsc`.

## Configuration

Everything lives in `~/.picobu/options.json` (auto-created as `{}` on first run). Four top-level blocks:


| Key | Purpose |
| --- | --- |
| `providers` | AI providers and their models, billing, and capabilities |
| `harness` | `defaultModel` (`"<providerId>/<modelId>"`) plus per-role model/thinking overrides |
| `theme` | Persisted theme choice (`key`, `variant`) — defaults to `{ "key": "tacos", "variant": "dark" }` |
| `web` | Web (xterm.js) server binding — defaults to `{ "host": "0.0.0.0", "port": 8080 }` |


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
  },
  "web": {
    "host": "0.0.0.0",
    "port": 8080
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
| `esc` | Close an open picker or dialog |
| `ctrl+?` | Open the help dialog with all shortcuts (typing `?` as the prompt's first character works too) |
| `esc esc` (while streaming) | Interrupt the current run (partial output stays; a prompt with no response yet is removed) |
| `ctrl+q` | Toggle prompt-queue mode (double border) — prompts submitted mid-run run after it finishes |
| `ctrl+w` | Toggle prompt-steering mode (heavy border) — the next prompt stops the current run and takes over |
| `ctrl+c` | Exit (prints a resume hint) |

While the agent is streaming, all keys except `esc esc` are swallowed so the run can't be interrupted mid-step. Dialogs close on `esc` or by clicking their backdrop.

## Sessions

Every run is saved incrementally (per message) to `~/.picobu/sessions/<folder>/<id>.jsonl` — `<folder>` is the sanitized name of the working directory, `<id>` the 16-hex session id shown on exit. A session is only saved **after its first prompt** — an untouched session leaves no file behind. Resume with `picobu --session <id>` (also listed by `picobu sessions`), or in-app via `/sessions`. The coding page has a second tab, "persistent session": each prompt runs as a fresh, tool-less, 10-step-max session saved to `~/.picobu/sessions/persitent/<timestamp>-<turn>.jsonl`.

### Slash commands

- `/models` — open the model picker (same as `ctrl+m`)
- `/effort [level]` — set thinking effort directly (`/effort high`) or open the picker
- `/new` (`/cls`, `/clear`) — start a fresh session; the current one stays saved on disk
- `/sessions` — list saved sessions for the current folder and load one into the coding tab
- `/quit` — graceful exit

Commands declare the session modes they are available in via flags: `code` (coding tab), `persitent` (persistent tab), and `web` (browser client). Commands default to all three; `/quit`, `/new`, and `/sessions` omit `web`, and `/new` + `/sessions` also omit `persitent` — invoking a command outside its modes shows a footer toast instead of running.

Commands are also discovered from markdown files in `.agents/skills`, `.agents/workflows`, `.agents/prompts`, and `.agents/commands` — checked in your project, `~/.picobu`, and home, in that precedence order.

## Agents

Each agent has a `category` that binds it to a session mode: `coding` agents appear only on the coding tab, `persistent` agents only on the persistent tab (Tab cycles agents within the active category).

| Agent | Category | Role |
| --- | --- | --- |
| `ask` | coding | Fast Q&A, runs on the `flash` role |
| `coder` | coding | The default coding loop, runs on the `flash` role |
| `plan-code` | coding | Deep planning + implementation, runs on the `heavy` role |
| `persistent` | persistent | Fresh, stateless 10-step runs per prompt |

## Tools

Tools are grouped in families:

- **filesystem** — `read` / `write` / `edit` (file I/O with diffs), `glob` / `grep` (search, ripgrep-backed), `bash` (shell execution using your detected shell)
- **flow** — session workflow state. Currently `todo`: one todo list per session, persisted at `<folder>/<sessionId>/session-todo.json` and fully rewritten on every call. Actions: `ins` (append items), `upd` (replace by index), `del` (remove by index). Rendered in the chat as a phase tree with `[x]` / `[ ]` per item.
- **external** — web access via headless Chrome (Puppeteer), so JavaScript-rendered pages are captured correctly; requests carry a real-Chrome identity (UA + client hints, `navigator.webdriver` scrubbed) to avoid bot-protection blocks. `websearch` queries DuckDuckGo's HTML endpoint — `query` plus `deepness` (result pages, 1–5), paginated via the `s` offset; every link found across those pages is fetched and its content attached as Markdown. `webfetch` fetches a URL and returns its contents as Markdown (HTML pages are converted with turndown; other content types pass through verbatim).

Every tool carries a JSON Schema rendered into the system prompt, and calls are rendered live in the chat as expandable tool cards.

## Session title & prompt history

- The first prompt of a coding session (or the latest prompt of a persistent session) is turned into a short **session title** by a single `tiny`-role model call, shown in the header next to the session tabs. Falls back to a truncated prompt when the call fails.
- The prompt box keeps a rolling history of the last 10 prompts, persisted in `~/.picobu/prompt-history.json` so it survives restarts. `ArrowUp` at cursor position 0 cycles back, `ArrowDown` at/after the last character cycles forward (restoring your in-progress draft past the newest entry); editing a recalled prompt moves it to the top of the stack.

## Themes

44 themes are bundled (aura, ayu, ayu-light, bluloco-dark, carbonfox, catppuccin variants, doom-one, dracula, flexoki, gruvbox, horizon + horizon-darker, kanagawa, monokai, nord, one + one-darker, rose-pine variants, solarized, tacos, tokyo-night variants, vitesse + vitesse-darker, zenburn, and more). Switch with the mouse in the header bar: click the theme name or arrows to cycle, and click the variant label to toggle dark/light. Your choice persists across launches.

## Project layout

```
src/
├── components/        # UI: header, dialogs (help), chat messages, tool-call cards, pickers, theme switcher
├── cli.ts / tui.ts    # CLI entry point (`picobu`, `--web`, `--session`, `sessions`)
├── harness/           # Agent runtime: providers, agent factory, loop, prompts, toolset, commands
├── hooks/             # Run metrics, git status, keybinds, completion notifications
├── libs/              # options, lock, shell, sessions, prompt history, session title, notify, text stats, filetype
├── pages/             # SessionPage (coding + persistent tabs), SettingsPage, ThreeDPage (empty)
├── providers/         # CodingSession + PersistentSession contexts
├── stores/            # XState stores: loop, theme, coding, session titles
└── themes/            # Theme definitions + 44 JSON color assets
```

## Tech stack

[OpenTUI](https://git.new/create-tui) · Vercel AI SDK (`ai`, `@ai-sdk/*`) · XState Store · Zod · Bun

This project was scaffolded with `bun create tui` — the easiest way to get started with OpenTUI.