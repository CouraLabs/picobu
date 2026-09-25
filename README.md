# Picobu

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

An open-source coding agent for your terminal. Point Picobu at a project and it reads the code, reasons about the task, edits files, runs commands, and verifies its own work — in a fast OpenTUI interface built on the Vercel AI SDK.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
  - [Agents](#agents)
  - [Tools](#tools)
  - [Providers and models](#providers-and-models)
  - [Sessions](#sessions)
  - [Configuration](#configuration)
- [Documentation](#documentation)
- [WhatsApp](#whatsapp)
- [Related Efforts](#related-efforts)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Picobu started from frustration. I used Claude Code, Codex, GitHub Copilot, Opencode, and Pi extensively — and each of them got something right. Claude Code's agentic loop, Codex's task focus, Copilot's editor presence and model access, Opencode's openness and provider flexibility, Pi's minimalism. But none of them put the whole package together: every tool locked the agent to its own interface, its own provider deals, its own opinions about how you should work. Switching tools meant relearning workflows and losing session history.

Picobu is that package: a coding agent for your terminal, with the best ideas from each of those tools built in. Point it at a project and it reads the code, reasons about the task, edits files, runs commands, and verifies its own work — with a rich OpenTUI interface for streaming runs, reviewing plans, and steering mid-flight. Underneath, the agent runtime stays headless and UI-agnostic, so the CLI, the headless server, and anything you build on the session facade drive the exact same loop, skills, and history. That core owns the agent loop (`ToolLoopAgent` from the `ai` SDK), session persistence, model resolution, tool execution, subagent delegation, MCP clients, OAuth credentials, and checkpointed undo/redo.

The ideas worth keeping: strong plan-then-execute flows, an interview-first design agent, interruptible `ask` steps, delegating subagents, model-role routing, MCP extensibility, and persistent sessions with undo.

Project instructions are automatic: when a session starts, the system prompt embeds `AGENTS.md` (or `CLAUDE.md`) from the working directory (truncated at 2000 chars), plus discovered skills, rules, subagents, and MCP tool schemas.

## Install

Requirements:

- [Bun](https://bun.sh) ≥ 1.3.0
- A terminal font with current programmer-glyph coverage (e.g. an up-to-date Source Code Pro, JetBrains Mono, or equivalent Nerd Fonts coverage) — the TUI status icons assume it
- A model: an API key (any `@opencode-ai/models` provider `env` var, e.g. `HYPER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`) or an OAuth login — see [Providers and models](#providers-and-models)

Install with [Bun](https://bun.sh) from npm (puts `picobu` on your PATH; installs `bun` and provisions Chrome for the web tools when missing):

```sh
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.sh | bash
```

On Windows (PowerShell):

```powershell
powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.ps1|iex"
```

Without installing anything (`bun` runs the published package directly):

```sh
bunx @couralabs/picobu
```

Or manage the global package yourself:

```sh
bun add -g @couralabs/picobu     # install
bun update -g @couralabs/picobu  # update
bun remove -g @couralabs/picobu  # remove
```

From source:

```sh
git clone https://github.com/CouraLabs/picobu.git
cd picobu
bun install
bun dev
```

The installers pin the release they shipped with; set `PICOBU_VERSION=latest` to track the newest release. Sessions, settings, and credentials live in `~/.picobu`.

Uninstall (removes the global package, the data directory `~/.picobu`, and any legacy `~/.picobu/bin` PATH entry):

```sh
curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/uninstall.sh | bash
```

Install troubleshooting, verification, and smoke-test notes live in [docs/install.md](docs/install.md).

## Usage

Launch `picobu` in a project directory to open the TUI on a session for that folder:

```sh
picobu                    # open the TUI
picobu --session <id>     # open the TUI resuming a session
picobu --cd <folder>      # open the TUI with <folder> as cwd/workspace
picobu --server           # start the headless server (no UI)
picobu sessions           # list saved sessions for the current folder
```

At the prompt, type a request and press enter. Streamed text, reasoning, and tool calls render as they happen; `ask` questions and plan reviews pause the run for your input. Type `/` for the command flyout (`/models`, `/fork`, `/compact`, `/summarize`, `/new`, `/reload`, `/export`, …), `!` to run a raw shell command in the workspace, or `SHIFT+TAB` to cycle agents. Press `F1` for the always-current keybinding help.

The session footer shows the active agent, model, thinking effort, run state, token/timing metrics, cost, and MCP status; the header shows the workspace, context, and notifications. Both are rearranged with the layout dialogs. See [docs/keybindings.md](docs/keybindings.md) and [docs/usage.md](docs/usage.md) for the full tour.

### Agents

Picobu ships five built-in agents:

| Agent | What it does |
| --- | --- |
| `coder` | The default. Edits files, runs commands, and verifies end to end. |
| `ask` | Fast, read-only Q&A — cannot edit or execute. |
| `grill` | Interviews you to reach a shared design before any plan or code. |
| `plan-code` | Produces an ordered implementation plan and hands off to the coder on approval. |
| `persistent` | Runs each prompt as a fresh, stateless session mode. |

`SHIFT+TAB` cycles the four conversational agents (`ask` → `grill` → `plan-code` → `coder`). Agents delegate work to four built-in subagents — `executor`, `explorer`, `reviewer`, `debugger` — via the `spawn` tool, which runs each as an isolated sub session. You can add your own subagents as markdown files in `.agents/agents/*.md`. See [docs/usage/agents.md](docs/usage/agents.md).

### Tools

Agents work with a built-in tool catalog: `read`, `write`, `edit`, `glob`, `grep`, and `shell` (streaming output, background jobs, timeouts; collect with `task_output`, stop with `task_stop`) for the filesystem; `todo`, `skill`, `rule`, `ask`, `plan-write`, `plan-exit`, `grill-exit`, and `spawn` for flow; `websearch` and `webfetch` for the web. MCP servers add namespaced tools at runtime, active for every agent that doesn't declare `tools: none`. See [docs/usage/tools.md](docs/usage/tools.md).

### Providers and models

Picobu talks to any provider the Vercel AI SDK supports. Providers autoload from the [models.dev](https://models.dev) catalog when their API-key env vars are set, or you can log in to a subscription provider with OAuth:

```sh
picobu login                    # list OAuth provider status
picobu login <provider>         # start a login (openai, anthropic, github-copilot, xai, …)
picobu logout <provider>        # log out and repoint harness selectors
```

Model access is organized into roles (`tiny`, `flash`, `heavy`) that agents map onto, editable in `options.json`. See [docs/configuration/providers.md](docs/configuration/providers.md).

### Sessions

Every conversation is a session, persisted incrementally to `~/.picobu/sessions/`. Sessions resume by id, fork, compact, summarize, and export to HTML; every write/edit is checkpointed so you can undo and redo. The last 20 prompts (and drafts) persist per project, recalled with `TAB`.

### Configuration

All settings live in one file, `~/.picobu/options.json` — providers, harness and model roles, theme (35 bundled) and TUI layout, MCP servers, watchdog, and the WhatsApp block. It is seeded with defaults on first launch and migrated as Picobu evolves. See [docs/configuration/options.md](docs/configuration/options.md).

## Documentation

Full documentation is modular under [`docs/`](docs/README.md) — usage, keybindings, install, frontends, configuration, agents, tools, sessions, and MCP. Start with [docs/README.md](docs/README.md).

## WhatsApp

A Baileys integration (unofficial WhatsApp Web API) lives in `src/integrations/whatsapp/` — connection and reconnect handling (auth persisted to `~/.picobu/whatsapp/auth`, 0700, retrying 10×/3s), the QR/pairing-code status store, contacts, the `today` todo list (`~/.picobu/whatsapp/today.json`), an inbound bus, and the `wwp-msg`/`wwp-today` agent tools.

The connection is **not wired into the current runtime**: the CLI bootstrap and the TUI neither call `connectToWhatsApp()` nor subscribe to inbound messages, so the `whatsapp.enabled`/`allowedNumbers` options are inert today and the integration is dormant until a host frontend wires the bus and the connection back up. The modules and tools remain importable and tested.

## Related Efforts

- [Vercel AI SDK](https://sdk.vercel.ai/) — the agent loop (`ToolLoopAgent`) and provider integrations Picobu builds on.
- [Model Context Protocol](https://modelcontextprotocol.io/) — the open tool-server protocol Picobu speaks.
- [OpenTUI](https://github.com/sst/opentui) — the terminal-UI framework behind the reference TUI.
- [standard-readme](https://github.com/RichardLitt/standard-readme) — the specification this README follows.

## Maintainers

[@CouraLabs](https://github.com/CouraLabs).

## Contributing

Not fillable yet — no contribution guidelines, code of conduct, or issue/PR workflow is documented. For now, please open an issue or pull request on GitHub.

## License

[MIT](LICENSE) © 2026 CouraLabs
