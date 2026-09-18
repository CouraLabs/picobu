# Sessions

Every conversation is a session. Sessions persist incrementally to `~/.picobu/sessions/<folderKey>/<id>.jsonl` (`<folderKey>` = sanitized cwd, `<id>` = 16 hex chars) — but only after the first prompt. A meta sidecar (`<id>.meta.json`) records cwd, parent link, lifecycle state (`running`/`waiting`/`finished`/`error`), title, and model; a meta stuck in `running` after a crash downgrades to `error` on load.

## The Session facade

`Session` is the API every frontend (the reference TUI, or one you build) drives:

- **Runs**: `sendMessage`, `queue` (parks a prompt until the run settles), `steer` (mid-run follow-up), `regenerate`, `stop`/`abort`, `flush` (awaits persistence), `close` (stops the run, drains state, tears down MCP included).
- **Streaming**: `stream()` (raw chunks), `streamMessages()` (whole messages), `onQueueChange`/`onStatsChange` notifications.
- **History**: `revertToMessage` (truncates + persists), `undo`/`redo` (file-level, no LLM call, refused mid-run; new edits drop the redo tail; shell mutations are not checkpointed), `switchAgent`/`switchModel`/`switchThinking` mid-session, `addToolOutput` (delivers `ask`/`plan-write` answers without a run), `summarize` (read-only one-shot summary).
- **Catalogs**: `skills`, `workflows`, `rules`, `agents`, `mcp` (snapshots, tool names, `refresh()`).

`SessionManager` rounds it out: `changeDirectory(path)` starts a new session under the new folder key (worktrees run concurrently with separate sandboxes), `forkSession` clones a session, plus `listSessions`, `listSessionTree`, `renameSession`, and `deleteSession` (cascade to sub sessions, refuses running subtrees).

## Sub sessions and spawn

The `spawn` tool runs a subagent as an isolated sub session:

- Blocking — it waits for every call to settle; parallel spawns settle together.
- Root spawns queue FIFO; nested spawns fail fast when over capacity, so holders can never deadlock.
- Depth cap 3.
- Subagents never get interactive tools (`ask`, `plan-write`, `plan-exit`) and report back `{ sessionId, summary }`.
- `manager.jobs()` / `onJobs()` / `abortJob()` expose the job registry.

## Cost and metrics

`session.stats` is the lifetime `LoopStats` view: per-step usage and cost, with `total` accumulating cost across runs, persisted to `<id>.stats.json` on every step and settle.

The footer under the prompt has four rows; token and timing segments reflect the latest step, while `$` cost is the session lifetime total:

- **Agent row**: agent, model, thinking level, finish reason or live activity (`Prompting`, `Reasoning`, `Tooling`, `Delegating`, `Answering`), session title.
- **Metrics row**: `TTFT` time to first output, `TPS` output tokens/sec, `TT` tool execution time, `↑` input tokens, `↓` output tokens, `⛁` cache total (hit %), `$` session cost.
- **Session row**: message count, tool calls, MCP connections, queue state.
- **Provider row**: up to 8 `statusLine` chips (`Label value`, sticky-last across runs, `Label -` when never resolved) — see [../configuration/status-line.md](../configuration/status-line.md).

## Sandbox

Each session runs inside a local sandbox rooted at its cwd (AI SDK `experimental_sandbox` over Bun):

- `shell` uses your detected shell; abort kills running commands.
- Relative paths resolve against the cwd; any path resolving outside the sandbox root is rejected.
- `setSandbox(false)` is a runtime kill switch for subsequently created sessions.
- In the TUI, `CTRL+P` toggles the sandbox for the next run — see [../keybindings.md](../keybindings.md).

## Prompt history and titles

The last 20 prompts (and drafts) persist per project to a SQLite store at `~/.picobu/prompts.db`; in the TUI, `TAB` cycles back through them and returns to your draft at the end. Session titles come from a one-shot `tiny`-role model call (≤ 50 chars).

## Watchdog

The watchdog detects runs that stopped making progress. A run counts as stale when it is in `submitted`/`streaming` state, has no error, is not waiting on an interactive tool (`ask`/`plan-write`), has been idle past `staleTimeoutMs` (default 300000ms, floor 5000), and has neither a finish reason nor assistant text in its latest messages.

| Option (in `watchdog`) | Default | Effect |
| --- | --- | --- |
| `staleTimeoutMs` | `300000` | Idle time before a run is stale |
| `enableNotificationWhenStale` | `true` | Surface a stale-run notification |
| `enableContinuePromptWhenStale` | `false` | Offer a continue prompt on stale runs |

## See also

- [../configuration/status-line.md](../configuration/status-line.md) — provider chips row
- [../configuration/session-layout.md](../configuration/session-layout.md) — rearrange the footer/header segments
- [../configuration/options.md](../configuration/options.md) — watchdog options
- [agents.md](agents.md) — the agents that run inside sessions
