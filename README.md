# Picobu

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

A headless autonomous coding agent core. One agent loop — read, plan, edit — exposed as a library and a minimal CLI, built on the Vercel AI SDK. Attach your own frontend (TUI, web, chat bot) on top, or drive it from the WhatsApp integration that ships in-repo.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
  - [CLI](#cli)
  - [Configuration](#configuration)
  - [Agents](#agents)
  - [Tools](#tools)
  - [Sessions](#sessions)
  - [MCP (Model Context Protocol)](#mcp-model-context-protocol)
  - [WhatsApp](#whatsapp)
  - [Login & OAuth](#login--oauth)
  - [Host frontends](#host-frontends)
  - [Generator](#generator)
- [Badge](#badge)
- [Example READMEs](#example-readmes)
- [Related Efforts](#related-efforts)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
  - [Contributors](#contributors)
- [License](#license)

## Background

Picobu started from frustration. I used Claude Code, Codex, GitHub Copilot, Opencode, and Pi extensively — and each of them got something right. Claude Code's agentic loop, Codex's task focus, Copilot's editor presence and model access, Opencode's openness and provider flexibility, Pi's minimalism. But none of them put the whole package together: every tool coupled the agent to its own interface, its own provider deals, its own opinions about how you should work. Switching tools meant relearning workflows and losing session history, and bending any of them to a custom frontend — a bot, a web view, a chat channel — meant fighting the product instead of building on it.

So Picobu takes the opposite bet: keep the agent runtime headless and take the best ideas from each of those tools — strong plan-then-execute flows, interruptible `ask` steps, delegating subagents, model-role routing, MCP extensibility, persistent sessions with undo — and ship them as one open core you can attach anything to.

Technically, that means the core owns the agent loop (`ToolLoopAgent` from the `ai` SDK, 100-step cap per run), session persistence, model resolution, tool execution, subagent delegation, MCP clients, OAuth credentials, and the WhatsApp connection. Frontends — the reference OpenTUI terminal UI, or anything you build on the session facade and headless chat state — only render and drive runs.

Project instructions are automatic: when a session starts, the system prompt embeds `AGENTS.md` (or `CLAUDE.md`) from the working directory (truncated at 2000 chars), plus discovered skills, rules, subagents, and MCP tool schemas. Every write/edit is checkpointed for undo/redo and every run accumulates cost totals.

> Your documentation is complete when someone can use your module without ever
> having to look at its code.

Picobu aims at that bar: the session facade, CLI, and `~/.picobu/options.json` are the documented interface; the loop internals stay free to change.

## Install

Requirements:

- [Bun](https://bun.sh) ≥ 1.x
- A terminal font with current programmer-glyph coverage (e.g. an up-to-date Source Code Pro, JetBrains Mono, or equivalent Nerd Fonts coverage) — the TUI status icons assume it
- A model: API key (any `@opencode-ai/models` provider `env` var, e.g. `HYPER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`) or an OAuth login (see [Login & OAuth](#login--oauth))

From source:

```sh
git clone https://github.com/CouraLabs/picobu.git
cd picobu
bun install
bun dev
```

Compiled install (requires `git`; installs `bun` automatically when missing; tracks `main`; writes `~/.picobu/bin/picobu` and wires `PATH` for the current shell):

```sh
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.sh | bash
```

On Windows (PowerShell, writes `%USERPROFILE%\.picobu\bin\picobu.exe` and prepends it to the user `PATH`):

```powershell
powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.ps1|iex"
```

`webfetch`/`websearch` need the Puppeteer Chrome downloaded during `bun install`, so keep that step even for compiled installs.

Uninstall deletes `~/.picobu` entirely — executable, sessions, settings, and OAuth credentials:

```sh
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/uninstall.sh | bash
```

Or from a clone: `scripts/uninstall.sh` (`scripts/uninstall.ps1` on Windows).

Verify with:

```sh
bun run lint
bun run tsc
bun test tests/<dir>/<file>.test.ts
```

Smoke (`needs a real model in ~/.picobu/options.json`): `bun run src/dev/smoke.ts`. Unit tests need no real keys (fake model keys, tmp dirs).

## Usage

Run the bootstrap (autoloads providers, refreshes OAuth tokens, connects WhatsApp when enabled):

```sh
picobu                    # open the TUI
picobu --session <id>     # open the TUI resuming a session
picobu --cd <folder>      # open the TUI with <folder> as cwd/workspace
picobu --server           # start the headless server (no UI)
picobu sessions           # list saved sessions for the current folder
```

`picobu --server` bootstraps (autoloads providers, refreshes OAuth tokens, connects WhatsApp when enabled) and prints `picobu headless server ready (no UI attached).`

### CLI

Global flags: `--server` starts the headless server (no UI), `--session [id]` opens the TUI resuming a session, `--cd <folder>` opens the TUI with `<folder>` as cwd/workspace, `--clear-prompts-history` clears prompt history/drafts and exits.

```sh
picobu sessions                 # list sessions (id, timestamp, state, title/first prompt)
picobu sessions --dir ~/other   # list another worktree's sessions
picobu sessions tree            # roots with their sub sessions
picobu sessions rename <id> "New title"
picobu sessions delete <id>     # cascade delete, reports count, refuses running subtrees

picobu mcp                      # list servers: id type target [source] connected|disconnected auth + errors
picobu mcp login <serverId>     # OAuth login for an auth:true server (PKCE, localhost:19888)
picobu mcp logout <serverId>    # drop stored tokens

picobu login                    # list OAuth provider status (openai, anthropic, github-copilot, xai, openrouter, kimi-coding, digitalocean, snowflake-cortex, azure)
picobu login --help             # show provider ids to use with login <provider-id>
picobu login <provider> [opts]  # start login (opts = enterprise domain for Copilot, `headless` for OpenAI device flow, `<account> [role]` for Snowflake, `<resource-name>` for Azure)
picobu logout <provider>        # logout and repoint harness selectors
```

Direct TUI entry: `bun run src/tui/init.tsx [--session <id>] [--cd <folder>] [--debug]` (mouse + Kitty keyboard, 30–60fps).

### Configuration

Everything lives in `~/.picobu/options.json` (auto-created, auto-seeded, lock-guarded; corrupt files are backed up to `options.json.corrupt-<ts>`). Top-level blocks:

| Key | Purpose |
| --- | --- |
| `providers` | AI providers and their models, billing, and capabilities |
| `harness` | `defaultModel` (`"<providerId>/<modelId>"`), per-role model/thinking overrides, `maxAgents` |
| `tui` | `theme` (`{key, variant: dark\|light}`, default `picobu/dark`), `maxMessages` (default 20) |
| `web` | Web server `{host: 0.0.0.0, port: 8080}` |
| `whatsapp` | `enabled` flag and `allowedNumbers` allow-list |
| `mcp` | MCP `servers` map (see [MCP](#mcp-model-context-protocol)) |
| `watchdog` | Stale-run handling (`staleTimeoutMs` default 300000, stale notification/continue prompts) |

Supported provider `type` values: `openai`, `anthropic`, `openai-compatible`, `openai-responses`. API keys may reference the environment (`"env:VAR_NAME"`) or OAuth credentials (`"auth:<id>"`); MCP `headers`/`env` also accept `"env:VAR"` refs. A top-level `statusLine` block maps providers to chips on the session footer provider row without touching the provider entries themselves (see [Provider status line](#provider-status-line)).

Providers preload from the [`@opencode-ai/models`](https://models.dev) catalog by API key: at startup picobu loads every models.dev provider whose `env` vars are set (live list first, snapshot fallback), using each provider's `npm` field to select the `@ai-sdk/*` factory and each provider folder in `src/agent/model/providers/` for special headers. Charm Hyper additionally tries a live `/v1/models` fetch before the catalog fallback.

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
    },
    "maxAgents": 4
  }
}
```

Model roles:

| Role | Purpose | Default thinking |
| --- | --- | --- |
| `tiny` | fast, cheap lookups (session titles) | `none` |
| `flash` | default workhorse (ask + coder agents) | model's `defaultEffort` |
| `heavy` | deep reasoning (plan-code agent) | model's `defaultEffort` (`heavyThinkingLevel` → `high`) |

`harness.maxAgents` (default `4`) caps concurrent spawned sub sessions tree-wide and depth-inclusively. Set `0` to disable spawning entirely.

### Agents

| Agent | Role | Tools |
| --- | --- | --- |
| `ask` | Fast Q&A, `flash` | `read`, `grep`, `glob`, `skill`, `rule`, `websearch`, `webfetch`, `ask`, `spawn` |
| `coder` | Default coding loop, `flash` | `read`, `write`, `edit`, `apply_patch`, `glob`, `grep`, `shell`, `ask`, `todo`, `skill`, `rule`, `spawn`, `websearch`, `webfetch` |
| `plan-code` | Deep planning + implementation, `heavy` | `read`, `grep`, `glob`, `skill`, `rule`, `ask`, `plan-write`, `plan-exit`, `spawn` |
| `persistent` | Fresh, stateless 10-step runs per prompt (WhatsApp) | `wwp-msg`, `wwp-today`, `rule` |

Custom agents are markdown files with `name`/`description`/`category`/`tools`/`model` frontmatter (`*` = all tools). Built-in subagents (`executor`, `explorer`, `reviewer`) can be overridden per project via `.agents/agents/*.md`; project skills live in `.agents/skills/<name>/SKILL.md` (ships with `ai-sdk`, `baileys-wp`, `opentui`). Rules are flat markdown files with `name`/`description` frontmatter from `.agents/rules`, `~/.picobu/rules`, `~/.agents/rules` (missing description = skipped). Workflows, prompts, and commands resolve from project → `~/.picobu` → home, in that precedence order.

### Tools

| Tool | Family | Description |
| --- | --- | --- |
| `read` | filesystem | Read a file (`skip`/`limit` slice lines) or list a directory; rejects binaries, images/PDFs return metadata only, long output is capped |
| `write` | filesystem | Write contents to a path, creating parent directories; records an undo checkpoint |
| `edit` | filesystem | Replace `oldString` with `newString` (exact or whitespace-tolerant match); fails on missing matches, refuses ambiguous single replaces unless `replaceAll` is true, returns a diff |
| `apply_patch` | filesystem | Apply a verified unified diff across one or more files atomically; prefer `edit` for single small replacements |
| `glob` | filesystem | Find files by glob pattern; respects `.gitignore` |
| `grep` | filesystem | Search files with ripgrep regex; returns matching lines |
| `shell` | filesystem | Run a shell command; streams output live, kills on timeout |
| `todo` | flow | Session todo list (`ins` append, `upd` replace by index, `del` remove by index), persisted per session |
| `skill` | flow | Load a discovered skill by name (SKILL.md body + related file paths) |
| `rule` | flow | Load a discovered rule by name and apply it |
| `ask` | flow, interrupting | Ask the user up to 5 structured single/multiple-choice questions; run pauses for answers |
| `plan-write` | flow, interrupting | Submit the finished plan for review; run pauses for approval/rejection |
| `plan-exit` | flow | Handoff to Coder to implement the approved plan (only after explicit approval) |
| `spawn` | flow, blocking | Run a subagent by name as an isolated sub session; parallel spawns settle together |
| `websearch` | external | Web search via DuckDuckGo; `deepness` 1–5 sets pages scanned, each result fetched as Markdown |
| `webfetch` | external | Fetch a URL as Markdown via headless Chrome (JS-rendered pages supported) |
| `wwp-msg` | integration | Send a WhatsApp text message to a phone number |
| `wwp-today` | integration | Add a task to the user's `today` todo list |
| `mcp_<server>_<tool>` | mcp | Auto-discovered per-server tools, namespaced and capped at 64 chars |

Every tool carries a JSON Schema rendered into the system prompt. `glob`/`grep` always include agent config folders even when gitignored. Web tools use headless Chrome with a real-Chrome identity (bot-protection resistant); HTML converts to Markdown via turndown.

### Sessions

Every run is saved incrementally (per message) to `~/.picobu/sessions/<folder>/<id>.jsonl` (`<folder>` = sanitized cwd, `<id>` = 16-hex), but only after its first prompt. A meta sidecar (`<id>.meta.json`) records cwd, parent link, lifecycle state (`running`/`waiting`/`finished`/`error`), title, and lifetime cost totals; a meta stuck in `running` after a crash downgrades to `error` on load.

The `Session` facade drives every frontend:

- Runs: `sendMessage`, `queue` (parks a prompt until the run settles), `steer` (mid-run follow-up), `regenerate`, `stop`/`abort`, `flush`/`close` (drains and tears down, MCP included).
- Streaming: `stream()` (raw chunks), `streamMessages()` (whole messages), `onChange` notifications.
- History: `revertToMessage` (truncates + persists), `undo`/`redo` (file-level, no LLM call, refused mid-run; new edits drop the redo tail; shell mutations are not checkpointed), `switchAgent`/`switchModel`/`switchThinking` mid-session, `addToolOutput` (deliver `ask`/`plan-write` answers without a run), `summarize` (read-only one-shot summary), `fork`.
- Catalogs: `skills`, `workflows`, `rules`, `agents`, `mcp` (snapshots, tool names, `refresh()`).
- Multi-worktree: `changeDirectory(path)` starts a new session under the new folder key; worktrees run concurrently with separate sandboxes.

Sub sessions & spawn: `spawn` is blocking and waits for every call to settle; nested spawns fail fast when over capacity (root spawns queue FIFO) so holders can never deadlock; depth cap 3 (no self/ancestor spawns); subagents never get interactive tools (`ask`, `plan-write`, `plan-exit`) and report back `{ summary, usage }`. `manager.jobs()`/`onJobs()`/`abortJob()` expose the job registry.

Cost accounting: `session.usage` is last-run (status bar); `session.stats` is the lifetime `LoopStats` view — per-step usage and cost, `total` accumulated across runs, `currentTotal` as the live sum of all recorded steps — persisted to the session stats file on every step and settle.

Session footer: four rows under the prompt. Token and timing segments reflect the latest step; `$` cost is the session lifetime total.

- Agent row: agent, model, thinking level, finish reason or live activity (`Prompting`, `Reasoning`, `Tooling`, `Delegating`, `Answering`), session title.
- Metrics row: `⧖` time to first output, `↯` output tokens/sec, `⌛` step time, `↻` LLM response time, `⯿` tool execution time, `↑` input tokens, `↓` output tokens, `⛁` cache total (hit %), `$` session cost, cost split (`in` / `out` / `read` / `write`).
- Session row: message count (`u`ser / `a`ssistant), tool calls, run count with subagent cost, MCP connections, queue state.
- Provider row (`SessionProviderStatus`): provider id/name for the active model, plus up to 8 `statusLine` chips (`Label value`, sticky-last across runs, `Label -` when never resolved).

### Provider status line

A top-level `statusLine` array (sibling of `providers`) maps a provider id to status chips, so no provider entry needs editing:

```json
{
  "statusLine": [
    {
      "provider": "hyper",
      "items": [
        { "label": "Rate Day", "type": "header", "value": "x-ratelimit-remaining-day" },
        { "label": "Rate Hour", "type": "header", "value": "x-ratelimit-remaining-hour" },
        { "label": "Run HyperCredits", "type": "step-raw", "value": "cost.hypercredits" },
        { "label": "HyperCredits", "type": "endpoint", "endpoint": "/credits", "value": "balance" }
      ]
    }
  ]
}
```

Three item types:

| `type` | `value` source | Fetched |
| --- | --- | --- |
| `header` | response header name (case-insensitive) from the last step | every step |
| `step-raw` | dot-path (e.g. `cost.hypercredits`, `balances.0.total`) inside the last step's `usage.raw` provider payload | every step |
| `endpoint` | dot-path into the JSON returned by `endpoint`, fetched with the provider's own auth (`env:` api key or `auth:<id>` oauth as `Bearer`) | session start, run start + run end |

`endpoint` starting with `http://`/`https://` is used as-is; anything else is joined to the provider `baseUrl` (so `/credits` and `credits` are equivalent). Endpoint results persist in the session stats file, failures keep the last value, and fetching never blocks a run (10s timeout, fire-and-forget). Objects render as JSON, missing values render as `Label -`.

The `hyper` (Charm Hyper) provider ships with the above defaults: per-response day/hour rate-limit headers, per-run HyperCredits from the step payload, and account balance polled on run start/end. Missing entries are backfilled automatically (your edits are never overwritten).

Sandbox: each session runs inside a local sandbox rooted at its cwd (AI SDK `experimental_sandbox` over Bun); `shell` uses your detected shell, abort kills running commands; relative paths resolve against the cwd (absolute paths pass through — no jail in v1); `setSandbox(false)` is a runtime kill switch for subsequently created sessions.

Prompt history: last 20 prompts persist per project to a SQLite store at `~/.picobu/prompts.db` (drafts too); in the TUI, double-press Arrow Up/Down within 200 ms to cycle through them (single presses move the cursor normally). Session titles come from a one-shot `tiny`-role call (≤50 chars).

### MCP (Model Context Protocol)

Picobu connects to [MCP](https://modelcontextprotocol.io/) servers via `@ai-sdk/mcp` and merges their tools into every agent loop. Configure globally in `~/.picobu/options.json` and/or per project in `.mcp.json` (Claude-style `mcpServers` map; project wins on id collision):

```json
{
  "mcp": {
    "servers": {
      "linear": {
        "type": "http",
        "url": "https://mcp.linear.app/mcp",
        "auth": true,
        "instructions": "Use for issue tracking; always pass teamId"
      },
      "fs": { "type": "stdio", "command": "npx", "args": ["-y", "fs-mcp"] }
    }
  }
}
```

- Transports: `http` (recommended), `sse`, `stdio` (local only).
- Auth: `auth: true` servers use MCP OAuth (`picobu mcp login/logout`); tokens live in `~/.picobu/mcp-auth.json` and refresh at connect.
- Discovery: tools are namespaced `mcp_<serverId>_<toolName>`; all-tools agents get them automatically, explicit agents opt in by name. Each server's tools (plus config `instructions` or server initialize-time instructions) render into the `<Tools>` system-prompt section.
- Sessions own their MCP clients (lazy connect, closed on `session.close()`); Streamable HTTP reattaches; `session.mcp.refresh()` re-discovers mid-conversation.
- Elicitation is advertised but mid-tool-call user input is auto-declined (no interactive UI in the headless core yet).

### WhatsApp

Baileys integration (unofficial WhatsApp Web API) in `src/integrations/whatsapp/`. When `whatsapp.enabled` is set, `connectToWhatsApp()` runs at bootstrap and reconnects from `~/.picobu/whatsapp/auth` (0700) without a QR, retrying 10×/3s. `allowedNumbers` lists phone numbers allowed to talk to the agent (empty = nobody; outbound sending still works). Inbound messages from allowed numbers are submitted to the persistent session, which replies and acts via `wwp-msg`/`wwp-today`. Agent-sent texts carry an invisible zero-width-space sentinel so `fromMe` echoes are recognized and dropped. Pairing codes, QR/status/errors, contacts, and the `today` todo list (`~/.picobu/whatsapp/today.json`) are managed alongside the connection. Group (`@g.us`) and broadcast messages are ignored.

### Login & OAuth

`startLogin(id)` authenticates a subscription provider so you can run models without API keys. Credentials live in `~/.picobu/auth.json` (never `options.json`); providers register into `options.json` as `apiKey: "auth:<id>"` with models from the models.dev catalog (`@opencode-ai/models`):

| Provider | `type` | Notes |
| --- | --- | --- |
| `openai` | `openai` | ChatGPT browser OAuth (PKCE, local callback) or `picobu login openai headless` device flow; live `/v1/models` intersected with the models.dev `openai` catalog so only accessible models register |
| `anthropic` | `anthropic` | Claude browser OAuth (PKCE, local callback, `state` in token exchange like Pi); live `/v1/models` intersected with the models.dev `anthropic` catalog |
| `github-copilot` | `openai-compatible` | Device-code flow; base URL from the token `proxy-ep` and usable models from live `/models` (opencode-style `usable` filtering: policy, limits, `tool_calls`) intersected with the models.dev catalog |
| `xai` | `openai-compatible` | xAI device-code flow (SuperGrok subscription, copied from opencode); `@ai-sdk/xai` factory |
| `openrouter` | `openai-compatible` | OpenRouter PKCE loopback → permanent API key (copied from Pi, untested); `@openrouter/ai-sdk-provider` factory |
| `kimi-coding` | `openai-compatible` | Kimi Code subscription device flow (copied from Pi, untested); base `https://api.kimi.com/coding` |
| `digitalocean` | `openai-compatible` | DigitalOcean browser OAuth implicit flow (copied from opencode, untested); inference base `https://inference.do-ai.run/v1` |
| `snowflake-cortex` | `openai-compatible` | Snowflake PKCE (`picobu login snowflake-cortex <account> [role]`, copied from opencode, untested); base derived from account |
| `azure` | `openai-compatible` | Microsoft Entra ID via `az login` (`picobu login azure <resource-name>`, copied from opencode, untested); `@ai-sdk/azure` factory |

Aliases: `copilot` → `github-copilot`, `claude` → `anthropic`, `chatgpt`/`codex` → `openai`, `kimi` → `kimi-coding`, `snowflake` → `snowflake-cortex`, `do` → `digitalocean`. Tokens auto-refresh at bootstrap and before every run. First-time login also becomes `harness.defaultModel`. Logout removes the credential and provider and repoints harness selectors. API-key-only providers autoload too: Charm Hyper via `HYPER_API_KEY`, plus every models.dev provider with `env` (e.g. `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GITHUB_TOKEN`/`GOOGLE_API_KEY`/`XAI_API_KEY`/`OPENROUTER_API_KEY`) preloaded at startup with the `npm`-selected factory.

### Host frontends

Reference TUI (`bun run dev`, `src/tui/` over OpenTUI + Solid): session page with streamed text/reasoning/tool parts (`ask` renders its form inline, plans render for review), session header/status, message actions, diff viewer, dialogs/dropdowns, hover tooltips (`Tooltip` wrapper + `TooltipLayer` with dropdown-style flip/clamp positioning), splash screen, 35 bundled themes (`picobu` default, `resolveTheme`/`generateSyntax`), icon set, and Solid state primitives for dialogs, dropdowns, tooltips, theme, and toasts (`src/states/`). Clipboard goes through an OpenTUI service adapter.

Mouse: click the status-bar model to switch models, hover the todo count to preview the list, click a tool header to collapse/expand its output (disabled when empty), double-click a message for Revert/Copy/Fork, click a subagent row to open its session, drag-select text then CTRL/CMD + C to copy (ESC clears the selection). The full list lives in the in-app help (`CTRL + H`).

Library kit: `createHeadlessChatState()` implements the AI SDK `ChatState` contract over the loop (reuse `useChat` against any session); `src/wrappers/` bundles tree-sitter parser WASMs + highlight queries for 39 languages (`createTreeSitterClient()`, data under `~/.picobu/tree-sitter`); prompt history and session-title helpers round out host needs. No UI logic lives in the agent loop.

Project layout: `src/cli.ts` (entry + bootstrap) · `src/agent/` (`loop/`, `sessions/`, `model/`, `agents/` + `subagent/`, `prompts/`, `tools/filesystem|flow|web/`, `commands/`, `rules/`, `workflows/`) · `src/config/options.ts` (`~/.picobu/options.json`) · `src/auth/` (OAuth) · `src/integrations/` (WhatsApp + MCP) · `src/tui/` · `src/states/` · `src/wrappers/` · `src/shared/`. Every `src/` folder is importable as `@<folder>` via `tsconfig.json` paths (e.g. `import { options } from "@config/options.ts"`); tests import via relative paths and mirror `src/` under `tests/`. Tech stack: Vercel AI SDK (`ai`, `@ai-sdk/*`) · XState Store · Zod · Bun · Biome (single quotes, no semicolons, 2-space indent).

### Generator

Not applicable yet — Picobu ships no README or project generator. This section is kept for standard-readme compliance.

## Badge

If your README is compliant with Standard-Readme and you're on GitHub, it would be great if you could add the badge. This allows people to link back to this Spec, and helps adoption of the README. The badge is **not required**.

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

```
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
```

## Example READMEs

Not fillable yet — this README is the project's only standard-readme example. No separate `example-readmes/` directory is maintained.

## Related Efforts

- [standard-readme](https://github.com/RichardLitt/standard-readme) — the specification this README follows.
- [Vercel AI SDK](https://sdk.vercel.ai/) — the agent loop (`ToolLoopAgent`) and provider integrations Picobu builds on.
- [Model Context Protocol](https://modelcontextprotocol.io/) — the open tool-server protocol Picobu speaks.
- [OpenTUI](https://github.com/sst/opentui) — the terminal-UI framework behind the reference TUI.

## Maintainers

[@CouraLabs](https://github.com/CouraLabs).

## Contributing

Not fillable yet — no contribution guidelines, code of conduct, or issue/PR workflow is documented. For now, please open an issue or pull request on GitHub.

### Contributors

Not fillable yet — no contributor list is maintained.

## License

[MIT](LICENSE) © 2026 CouraLabs
