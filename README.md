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

## Install

Requires [git](https://git-scm.com) and [Bun](https://bun.sh) ≥ 1.x. The script clones the repo into `~/.picobu/install`, builds a standalone executable with `bun build --compile`, drops it in `~/.picobu/bin`, and adds that folder to your PATH.

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/install.sh | bash
```

```powershell
# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/install.ps1|iex"
```

To uninstall, which removes everything under `~/.picobu` including saved sessions, settings and OAuth credentials:

```bash
# Linux / macOS (add -y to skip the confirmation)
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/uninstall.sh | bash -s -- -y
```

```powershell
# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/uninstall.ps1|iex"
```

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

Assign a model to a role with the **`/model-roles`** command (aliases: `/roles`): it lists each role with its current assignment (falling back to `defaultModel`) and lets you pick any configured model. The selection is persisted to `harness.modelRoles` and applied to the runtime: switching agents applies that agent's role model, and assigning a role that the active agent runs on updates the live loop immediately. Roles without a thinking override (`flash`/`heavy` inherit the model's `defaultEffort`) leave your current thinking level untouched; `/effort` and `shift+tab` remain explicit overrides after a switch.

## Usage

| Key | Action |
| --- | --- |
| `return` | Submit the prompt / start a run |
| `shift+return` | New line in the prompt |
| `tab` | Cycle agents: ask → coder → plan-code |
| `shift+tab` | Cycle thinking levels: none → low → medium → high → xhigh → max |
| `ctrl+m` | Open the model picker |
| `ctrl+t` | Open the file-tree picker to link a file into the prompt as an accent-colored `@path` token |
| `/` | Live command palette (fuzzy list of system + discovered commands) |
| `esc` | Close an open picker or dialog |
| `ctrl+?` | Open the help dialog with all shortcuts (typing `?` as the prompt's first character works too) |
| `esc esc` (while streaming) | Interrupt the current run (partial output stays; a prompt with no response yet is removed) |
| `ctrl+q` | Toggle prompt-queue mode (double border) — prompts submitted mid-run run after it finishes |
| `ctrl+w` | Toggle prompt-steering mode (heavy border) — the next prompt stops the current run and takes over |
| `ctrl+c` | Exit (prints a resume hint) |

While the agent is streaming, all keys except `esc esc` are swallowed so the run can't be interrupted mid-step. Dialogs close on `esc` or by clicking their backdrop.

## WhatsApp

The WHATSAPP tab runs the Baileys integration (unofficial WhatsApp Web API). It is configured under the `whatsapp` options block: `enabled` auto-connects at startup, and `allowedNumbers` lists the phone numbers allowed to talk to the agent (empty = nobody; outbound sending still works). Pair once via the QR rendered on the WhatsApp tab, or — if the terminal is too small for the QR (~53+ rows needed) — click Connect, type your phone number (digits, with country code) and click "Pair with code", then enter the code in WhatsApp → Linked devices → "Link with phone number". Credentials persist under `~/.picobu/whatsapp/auth`, so later launches reconnect without a QR. The synced contact book (plus anyone you exchange messages with) feeds `/wwp:contacts`. Messages from allowed numbers are submitted to the persistent session, which can reply and act using the `wwp-*` tools. Agent-sent texts (the `wwp-*` tools and WhatsApp cron alerts) are prefixed with an invisible zero-width-space sentinel; when that outbound message echoes back into the socket (`fromMe` upsert), it is recognized by the sentinel and dropped, so agent replies never re-enter the persistent session as new turns.

### WhatsApp commands

- `/wwp:contacts` — list known contacts; pick one to stage `/wwp:msg <phone>|` into the prompt
- `/wwp:msg <phone>|<msg>` — send a WhatsApp text
- `/wwp:alert <phone>|<msg>|<level>|<HH:MM>` — daily alert; level 1 = plain message, 2 = + desktop notification, 3+ = urgent delivery
- `/wwp:list-alerts` — list active alerts with IDs
- `/wwp:rm-alert <alert-id>` — remove an alert
- `/wwp:today <todo-text>` — add a task to today's list
- `/wwp:reminder <frequency>|<description>|<HH:MM>` — recurring reminder (fires a desktop notification)
- `/wwp:list-reminders <reminders|today|all>` — list reminders and/or today's tasks
- `/wwp:rm-reminder <id>` — remove a reminder or today task

The same operations are exposed to the persistent agent as tools (`wwp-msg`, `wwp-alert`, `wwp-list-alerts`, `wwp-rm-alert`, `wwp-today`, `wwp-reminder`, `wwp-list-reminders`, `wwp-rm-reminder`), so the agent can send messages and manage alerts, reminders, and tasks itself.

## Pomodoro

The POMODORO tab runs the classic state machine: IDLE → WORK (25m) → SHORT_BREAK (5m) / LONG_BREAK (15m after every 4th pomodoro). The countdown is deadline-based and lives in a module-level store, so it keeps running (and fires a desktop notification + terminal bell) no matter which tab is open; the header tab shows the live time left as `POMODORO (23m21s)`. The big countdown renders as block-style ASCII art (`<ascii-font>`), and each phase duration is adjustable on the page with −/+ steppers (5–90 min, 5-min steps) — picks apply from the next timer onward and survive resets. Controls: Start / Pause / Resume / Reset / Skip, plus an auto-start toggle. Resetting or skipping during a WORK session does not count toward the completed total.

## Crons

The CRONS tab lists every persisted job (`~/.picobu/crons.json`) with an enable/disable toggle. Jobs run only while the app is open, evaluated on a 30s sweep; each job carries a schedule (interval or daily `HH:MM`) and an action — a WhatsApp message, a desktop notification, or a prompt to the persistent agent. Alerts (`/wwp:alert`) and reminders (`/wwp:reminder`) appear here automatically.

## Sessions

Every run is saved incrementally (per message) to `~/.picobu/sessions/<folder>/<id>.jsonl` — `<folder>` is the sanitized name of the working directory, `<id>` the 16-hex session id shown on exit. A session is only saved **after its first prompt** — an untouched session leaves no file behind. Resume with `picobu --session <id>` (also listed by `picobu sessions`), or in-app via `/sessions`. The coding page has a second tab, "persistent session": each prompt runs as a fresh, tool-less, 10-step-max session saved to `~/.picobu/sessions/persitent/<timestamp>-<turn>.jsonl`.

### Session compaction

When a session's used context (input + output tokens, the same metric the status bar renders) reaches **80% of the current model's context window**, the session is compacted automatically after the run settles: the whole conversation is sent to the **currently running model** with a compactor prompt, and the resulting summary becomes the first message of a **new session** the app switches to. The original session stays fully saved on disk. Compaction can also be triggered manually with `/compact`. Failures degrade to a footer toast and leave the session unchanged.

### Slash commands

- `/models` — open the model picker (same as `ctrl+m`)
- `/cd [directory]` — change the working directory (absolute, relative, or `~/...`) and start a fresh session (sessions are stored per folder); with no args it opens a directory-tree picker (`return` walks in, the `.` row confirms). The status bar, tools, and system prompt all follow the new cwd for the rest of the app's lifetime
- `/effort [level]` — set thinking effort directly (`/effort high`) or open the picker
- `/model-roles` (`/roles`) — show the harness model roles and assign a model to each (persisted to `harness.modelRoles`)
- `/new` (`/cls`, `/clear`) — start a fresh session; the current one stays saved on disk
- `/compact` — compact the session into a summary and continue in a new session (also runs automatically at 80% context)
- `/sessions` — list saved sessions for the current folder and load one into the coding tab

Commands that mutate the run's flow or context (`/cd`, `/compact`) are idle-only: while the agent is streaming they are hidden from the command picker and rejected with a footer toast.
- `/login [provider]` — OAuth login for subscription providers (see below)
- `/logout [provider]` — remove a provider login (credential + registered provider/models)
- `/quit` — graceful exit

Commands declare the session modes they are available in via flags: `code` (coding tab), `persitent` (persistent tab), and `web` (browser client). Commands default to all three; `/quit`, `/new`, and `/sessions` omit `web`; `/new`, `/sessions`, `/login`, and `/logout` also omit `persitent` — invoking a command outside its modes shows a footer toast instead of running.

Commands are also discovered from markdown files in `.agents/skills`, `.agents/workflows`, `.agents/prompts`, and `.agents/commands` — checked in your project, `~/.picobu`, and home, in that precedence order.

**Multiple commands per prompt:** a prompt starting with `/` can chain several commands. After accepting one (`tab`), typing another `/` re-opens the picker; every word-boundary `/token` that matches a command resolves on submit. System commands run in order; skill/workflow segments are expanded with the text that follows each one (its "user request") and all pieces concatenate into the outgoing prompt — e.g. `/effort high /opentui build a box` sets the effort, then sends the opentui skill instructions with that request. Text that doesn't match a command stays literal, and a prompt whose *first* token isn't a known command is sent as-is (no surprise executions).

### Login & OAuth

`/login` authenticates a subscription provider OAuth — **OpenAI** (ChatGPT), **Anthropic** (Claude Pro/Max), or **GitHub Copilot** — so you can run models without API keys. With no argument it opens a provider picker; `/login openai`, `/login anthropic`, and `/login copilot [enterprise-domain]` start the flow directly. A status dialog shows the auth URL / device code and opens the browser; progress, success, and errors land there (Cancel aborts the flow).

On success the OAuth credential is stored in `~/.picobu/auth.json` (never in `options.json`), and the provider is registered into `~/.picobu/options.json` the same way env-gated providers are (`apiKey: "auth:<id>"`, models from the models.dev catalog via `@opencode-ai/models`):

| Provider | `type` | Notes |
| --- | --- | --- |
| `openai` | `openai` | ChatGPT browser OAuth (PKCE, local callback); models from the models.dev `openai` catalog |
| `anthropic` | `anthropic` | Claude browser OAuth (PKCE, local callback); models from the models.dev `anthropic` catalog |
| `github-copilot` | `openai-compatible` | Device-code flow; base URL and usable models depend on the account/token (fetched from `/models`) |

Credentials auto-refresh at startup and before every run; if a provider is first-time-logged-in it also becomes `harness.defaultModel`. `/logout` removes the credential from `auth.json`, the provider (and its models) from `options.json`, and repoints any harness/session model selectors at a remaining provider.

## Agents

Each agent has a `category` that binds it to a session mode: `coding` agents appear only on the coding tab, `persistent` agents only on the persistent tab (Tab cycles agents within the active category).

| Agent | Category | Role |
| --- | --- | --- |
| `ask` | coding | Fast Q&A, runs on the `flash` role |
| `coder` | coding | The default coding loop, runs on the `flash` role |
| `plan-code` | coding | Deep planning + implementation, runs on the `heavy` role |
| `persistent` | persistent | Fresh, stateless 10-step runs per prompt |

Coding runs are capped at **100 steps** as a safety limit (each tool call round-trip is a step; the `ask`/`plan-write` interrupts pause before a new step starts). The persistent session keeps its own 10-step cap per prompt.

Project instructions are loaded automatically: when a session starts, the system prompt embeds the `AGENTS.md` (or `CLAUDE.md`) from the working directory, appended at the end of the guidelines section — no need to ask the agent to read it.

## Tools

Tools are grouped in families:

- **filesystem** — `read` / `write` / `edit` (file I/O with diffs), `glob` / `grep` (search, ripgrep-backed), `bash` (shell execution using your detected shell). `glob` and `grep` respect `.gitignore`, except that agent config folders — `.agents/` in the project and home, plus `~/.picobu/{skills,workflows,prompts,commands,rules}` — are always included, even when dot-prefixed or gitignored.
- **flow** — session workflow state.
  - `todo`: one todo list per session, persisted at `<folder>/<sessionId>/session-todo.json` and fully rewritten on every call. Actions: `ins` (append items), `upd` (replace by index), `del` (remove by index). Rendered in the chat as a phase tree with `[x]` / `[ ]` per item.
  - `skill` (non-interrupting): loads a discovered skill by name. The output carries the skill's frontmatter-stripped SKILL.md body plus its folder path and the relative paths of the related files in it, which the agent then reads with `read` as the instructions reference them. Available to the ask/coder/plan agents; the system prompt lists every installed skill's name and description (a `<Skills>` section) so the agent knows when to reach for it — task matches the description or the user asks for it by name.
  - `rule` (non-interrupting): loads a discovered rule by name — modular instructions for specific cases (e.g. a `testing.md` rule whose description says it applies when generating tests). Rules are flat markdown files with `name`/`description` frontmatter, discovered from `.agents/rules`, `~/.picobu/rules`, and `~/.agents/rules` in that precedence order. Available to all agents; the system prompt lists every installed rule's name and description (a `<Rules>` section) so the agent loads the ones whose description matches the current task.
  - `ask` (interrupting): asks the user up to 5 structured questions. Each question renders as a tab with clickable radios (`single`) / checkboxes (`multiple`) plus an automatic custom-answer field; once all questions are answered the answers are sent back as a new prompt. Available to the ask/coder/plan agents.
  - `plan-exit` (non-interrupting): handoff tool that switches the running loop from the Plan agent to the Coder agent mid-run so the approved plan is implemented immediately. It flips the active agent exactly like a manual picker change (tab): the picker visibly shows Coder and the coder's `flash` role config applies from the next step.
  - `plan-write` (interrupting): submits the finished plan for review. The run pauses and a dialog opens with the plan rendered line by line — click a line to add a comment below it. "Not satisfied" sends the comments back as a revision prompt (the plan agent revises and resubmits until approved); "Confirm" sends an approval prompt and the agent calls `plan-exit` so the Coder implements with the comments in hand.
- **external** — web access via headless Chrome (Puppeteer), so JavaScript-rendered pages are captured correctly; requests carry a real-Chrome identity (UA + client hints, `navigator.webdriver` scrubbed) to avoid bot-protection blocks. `websearch` queries DuckDuckGo's HTML endpoint — `query` plus `deepness` (result pages, 1–5), paginated via the `s` offset; every link found across those pages is fetched and its content attached as Markdown. `webfetch` fetches a URL and returns its contents as Markdown (HTML pages are converted with turndown; other content types pass through verbatim). Both stream live progress to the UI (spinner + a running status in the tool header: search pages found, results fetched so far).

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
├── pages/             # SessionPage (coding + persistent tabs), ThreeDPage (empty)
├── providers/         # CodingSession + PersistentSession contexts
├── stores/            # XState stores: loop, theme, coding, session titles
└── themes/            # Theme definitions + 44 JSON color assets
```

## Tech stack

[OpenTUI](https://git.new/create-tui) · Vercel AI SDK (`ai`, `@ai-sdk/*`) · XState Store · Zod · Bun

This project was scaffolded with `bun create tui` — the easiest way to get started with OpenTUI.