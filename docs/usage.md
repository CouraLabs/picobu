# Using Picobu

Launch `picobu` (or `bun dev` from a clone). Bootstrap runs first — providers autoload, OAuth tokens refresh — then the TUI opens on a session for the current folder.

## A session, end to end

1. **Prompt.** Type at the prompt and press enter. The active agent (Coder by default) starts a run: streamed text and reasoning appear as they generate, and tool calls render as collapsible blocks with their output.
2. **Interrupts.** When the agent needs a decision it uses `ask`, which renders a structured question form inline — the run pauses until you answer. The Plan agent submits its plan with `plan-write`, which pauses for your approval or rejection before any code is written.
3. **Queue and steer.** Prompts typed while a run is active are queued (`queue`); steer mode (`CTRL+W`/`F4`) delivers your follow-up mid-run instead (`steer` — it never clears the queue). `ESC ESC` interrupts: answers the flow first, moves the newest queued prompt back to edit, then stops the run.
4. **Wrap up.** `/q` quits; sessions persist automatically, so `picobu --session <id>` (or `--session` alone) resumes where you left off.

## Slash commands

Type `/` at the prompt for the command flyout. Built-ins:

| Command | Aliases | Does |
| --- | --- | --- |
| `/q` | `/exit`, `/leave` | Quit the app |
| `/models` | — | Switch model |
| `/fork` | — | Fork the session at the last message |
| `/summarize` | — | Summarize the session |
| `/compact` | — | Compact session context via summary |
| `/roles` | — | Assign models and thinking levels to roles |
| `/cd <path>` | — | Change project folder (starts a new session) |
| `/new` | `/clear`, `/cls` | Start a new session |
| `/reload` | — | Reload skills, workflows, rules, agents, prompts and MCP from disk |
| `/export [out.html]` | — | Export current session to HTML |
| `/session-status-view` | `/session-status`, `/status-view` | Configure the session status bar layout |
| `/session-header-view` | `/session-header`, `/header-view` | Configure the session header layout |

Skills (`/skill:<name>`) and project workflows appear in the flyout dynamically as they're discovered. `TAB` completes the highlighted command; `UP`/`DOWN` move the highlight.

## Where to next

- [keybindings.md](keybindings.md) — every chord and mouse action
- [usage/cli.md](usage/cli.md) — flags and subcommands
- [usage/agents.md](usage/agents.md) — switching agents and adding your own
- [configuration/options.md](configuration/options.md) — tuning providers, themes, and the footer

## See also

- [install.md](install.md) — getting it running
- [usage/sessions.md](usage/sessions.md) — what persists and how undo/redo works
