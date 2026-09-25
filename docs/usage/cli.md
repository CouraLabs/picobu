# CLI reference

`picobu` is the single entry point: it bootstraps the app (autoloads providers, refreshes OAuth tokens) and then opens the TUI or runs a subcommand. `bun dev` from a clone does the same as `picobu`.

## Global flags

```sh
picobu                    # open the TUI
picobu --session <id>     # open the TUI resuming a session
picobu --cd <folder>      # open the TUI with <folder> as cwd/workspace
picobu --server           # start the headless server (no UI)
picobu sessions           # list saved sessions for the current folder
```

| Flag | Effect |
| --- | --- |
| `--server` | Headless bootstrap, no UI. Prints `picobu headless server ready (no UI attached).` and stays alive; SIGINT/SIGTERM shut it down. Cannot be combined with `--session` or `--cd`. |
| `--session <id>` | Open the TUI resuming the session with `<id>`. Bare `--session` (no id) does not resume — it opens a fresh session. |
| `--cd <folder>` | Open the TUI with `<folder>` as cwd/workspace. Must be an existing directory. |
| `--clear-prompts-history` | Clear all prompt history and drafts, then exit. |
| `--off-load` | Overwrite the bundled agent/subagent/workflow prompt markdowns under `~/.picobu` with the shipped versions, then exit (asks for confirmation first). |
| `--version` | Print the version. |

If a run fails, logs land in `~/.picobu/logs`.

## sessions

```sh
picobu sessions                 # list sessions (id, timestamp, state, title/first prompt)
picobu sessions --dir ~/other   # list another worktree's sessions
picobu sessions tree            # roots with their sub sessions
picobu sessions rename <id> "New title"
picobu sessions delete <id>     # cascade delete, reports count, refuses running subtrees
```

Session ids are immutable; `rename` changes the title only.

## mcp

```sh
picobu mcp                      # list servers: id type target [source] connected|disconnected auth + errors
picobu mcp login <serverId>     # OAuth login for an auth:true server (PKCE, localhost:19888)
picobu mcp logout <serverId>    # drop stored tokens
```

Server configuration lives in `~/.picobu/options.json` or the project `.mcp.json` — see [mcp.md](mcp.md).

## login / logout

```sh
picobu login                    # list OAuth provider status
picobu login --help             # show provider ids
picobu login <provider> [opts]  # start login
picobu login -f <provider>      # force re-login, skipping the already-logged-in check
picobu logout <provider>        # logout and repoint harness selectors
```

Providers, options, and flows are documented in [../configuration/providers.md](../configuration/providers.md).

## Direct TUI entry

From a clone, the TUI can be launched directly (bypassing CLI parsing):

```sh
bun run src/tui/init.tsx [--session <id>] [--cd <folder>] [--debug]
```

## See also

- [../configuration/providers.md](../configuration/providers.md) — login providers and flows
- [mcp.md](mcp.md) — MCP server configuration
- [../usage.md](../usage.md) — the interactive session tour and slash commands
