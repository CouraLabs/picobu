# Picobu

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

A headless autonomous coding agent core. One agent loop — read, plan, edit — exposed as a library and a minimal CLI, built on the Vercel AI SDK. Attach your own frontend (TUI, web, chat bot) on top, or drive it from the WhatsApp integration that ships in-repo.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Documentation](#documentation)
- [WhatsApp](#whatsapp)
- [Related Efforts](#related-efforts)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
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
- A model: API key (any `@opencode-ai/models` provider `env` var, e.g. `HYPER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`) or an OAuth login (see [docs/configuration/providers.md](docs/configuration/providers.md))

From source:

```sh
git clone https://github.com/CouraLabs/picobu.git
cd picobu
bun install
bun dev
```

Compiled install (requires `git`; installs `bun` automatically when missing; tracks the default branch (`master`); writes `~/.picobu/bin/picobu` and wires `PATH` for the current shell):

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

Install troubleshooting, verification, and smoke-test notes live in [docs/install.md](docs/install.md).

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

Full CLI, keyboard shortcuts, agents, tools, MCP, and configuration live in [`docs/`](docs/README.md).

## Documentation

All documentation is modular under [`docs/`](docs/README.md) — start there for usage, configuration, agents, tools, sessions, and MCP.

## WhatsApp

Baileys integration (unofficial WhatsApp Web API) in `src/integrations/whatsapp/`. When `whatsapp.enabled` is set, `connectToWhatsApp()` runs at bootstrap and reconnects from `~/.picobu/whatsapp/auth` (0700) without a QR, retrying 10×/3s. `allowedNumbers` lists phone numbers allowed to talk to the agent (the paired phone is always allowed regardless; outbound sending still works). Inbound messages from allowed numbers are submitted to the persistent session, which replies and acts via `wwp-msg`/`wwp-today`. Agent-sent texts carry an invisible zero-width-space sentinel so `fromMe` echoes are recognized and dropped. Pairing codes, QR/status/errors, contacts, and the `today` todo list (`~/.picobu/whatsapp/today.json`) are managed alongside the connection. Group (`@g.us`) and broadcast messages are ignored.

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
