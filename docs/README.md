# Picobu documentation

Modular documentation for Picobu, a headless autonomous coding agent core. Start with [usage](usage.md) for a guided tour, or jump straight to a topic below. The root [README](../README.md) holds the project background and install basics.

## Index

| File | What's inside |
| --- | --- |
| [usage.md](usage.md) | Guided tour: bootstrap, a session end to end, slash commands |
| [keybindings.md](keybindings.md) | Keyboard and mouse reference for the TUI |
| [install.md](install.md) | Requirements, install methods, uninstall, verification, troubleshooting |
| [frontends.md](frontends.md) | Reference TUI, host-frontend library kit, project layout, tech stack |
| [configuration/options.md](configuration/options.md) | `~/.picobu/options.json`: blocks, defaults, env vars, value refs |
| [configuration/providers.md](configuration/providers.md) | Providers and models, catalog autoload, model roles, OAuth login |
| [configuration/status-line.md](configuration/status-line.md) | Provider status chips on the session footer |
| [configuration/session-layout.md](configuration/session-layout.md) | Session header and status bar layout |
| [usage/cli.md](usage/cli.md) | `picobu` flags and subcommands: sessions, mcp, login, logout |
| [usage/sessions.md](usage/sessions.md) | Session persistence, facade APIs, spawn, stats, footer, sandbox, watchdog |
| [usage/agents.md](usage/agents.md) | Built-in agents, custom agents, skills, rules, workflows |
| [usage/tools.md](usage/tools.md) | The tool catalog agents run with |
| [usage/mcp.md](usage/mcp.md) | MCP servers: transports, auth, namespacing, discovery |

WhatsApp is currently documented in the root [README](../README.md#whatsapp).

## Where data lives

Everything Picobu persists sits under one system dir, `~/.picobu` by default (override with `PICOBU_SYSTEM_DIR`):

| Path | Contents |
| --- | --- |
| `options.json` | Settings: providers, harness, TUI, web, WhatsApp, MCP, watchdog |
| `sessions/<folderKey>/` | `<id>.jsonl` transcripts, `<id>.meta.json` sidecars, `<id>.stats.json` cost files |
| `prompts.db` | Last 20 prompts and drafts per project (SQLite) |
| `auth.json` | OAuth credentials for subscription providers |
| `mcp-auth.json` | OAuth tokens for MCP servers |
| `whatsapp/` | Baileys auth state (0700) and the `today.json` todo list |
| `logs/` | Runtime logs |
| `tree-sitter/` | Parser WASMs and highlight queries |
| `bin/picobu` | The compiled executable (installer-managed) |

## Precedence rules

- **Options**: one global file, `~/.picobu/options.json`. There is no per-project options file.
- **MCP servers**: global `mcp.servers` plus a per-project `.mcp.json`; the project wins on id collision.
- **Skills, rules, workflows, prompts, commands**: resolved project → `~/.picobu` → `~/.agents`, in that order.
- **Custom agents**: project-only, `.agents/agents/*.md`; they override built-in subagents by name.

## See also

- [README](../README.md) — background, install, WhatsApp
- [usage.md](usage.md) — start here for the app tour
- [configuration/options.md](configuration/options.md) — the settings file every other doc references
