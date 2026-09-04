# PICOBU

A headless autonomous coding agent core. One agent loop — read, plan, edit — exposed as a library and a minimal CLI, built on the Vercel AI SDK. Attach your own frontend (TUI, web, chat bot) on top, or drive it from the WhatsApp integration that ships in-repo.

## Requirements

- [Bun](https://bun.sh) ≥ 1.x

## Getting started

```bash
bun install       # install dependencies
bun dev           # run the bootstrap (providers, OAuth refresh, WhatsApp)
picobu sessions   # list saved sessions for the current folder (title + state)
```

Type-check with `bun run tsc`; run tests with `bun test`.

## Configuration

Everything lives in `~/.picobu/options.json` (auto-created as `{}` on first run). Top-level blocks:

| Key | Purpose |
| --- | --- |
| `providers` | AI providers and their models, billing, and capabilities |
| `harness` | `defaultModel` (`"<providerId>/<modelId>"`), per-role model/thinking overrides, and `maxAgents` |
| `whatsapp` | `enabled` flag and `allowedNumbers` allow-list for the WhatsApp integration |

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
| `tiny` | fast, cheap lookups (session titles) | `none` |
| `flash` | default workhorse (ask + coder agents) | model's `defaultEffort` |
| `heavy` | deep reasoning (plan-code agent) | model's `defaultEffort` (`heavyThinkingLevel` → `high`) |

### Sub agent concurrency

`harness.maxAgents` (default `4`) caps how many spawned sub sessions run concurrently across the whole session tree — a chain of sub agents counts each level. Set `0` to disable spawning entirely.

## WhatsApp

The Baileys integration (unofficial WhatsApp Web API) lives in `src/integrations/whatsapp/`. When `whatsapp.enabled` is set, `connectToWhatsApp()` is called at bootstrap and reconnects from persisted credentials under `~/.picobu/whatsapp/auth` without a QR. `allowedNumbers` lists the phone numbers allowed to talk to the agent (empty = nobody; outbound sending still works). Inbound messages from allowed numbers are submitted to the persistent session, which can reply and act using the `wwp-*` tools. Agent-sent texts are prefixed with an invisible zero-width-space sentinel; when that outbound message echoes back into the socket (`fromMe` upsert), it is recognized by the sentinel and dropped.

The same operations are exposed to the persistent agent as tools (`wwp-msg`, `wwp-today`), so the agent can send messages and list today's tasks itself.

## Sessions

Every run is saved incrementally (per message) to `~/.picobu/sessions/<folder>/<id>.jsonl` — `<folder>` is the sanitized name of the working directory, `<id>` the 16-hex session id. A session is only saved **after its first prompt** — an untouched session leaves no file behind. Saved sessions are listed with `picobu sessions` (id, timestamp, lifecycle state, and title — or the first prompt when untitled). The persistent agent keeps its own 10-step cap per prompt.

The **session manager** (`SessionManager`) owns the lifecycle: start/resume, list, delete (cascading to every sub session below the target — all-or-nothing, refused while anything in the subtree runs), rename (title only — the id and JSONL file name are immutable), and directory switching. The working directory is manager-owned: `changeDirectory(path)` starts a **new session** under the new worktree's folder key, and sessions in different worktrees run concurrently (each carries its own sandbox). A meta sidecar (`<id>.meta.json`) records the cwd, parent link, lifecycle state, title, and lifetime cost totals; a meta stuck in `running` from a crashed process is downgraded to `error` on load.

```bash
picobu sessions                 # list sessions (title + state)
picobu sessions --dir ~/other   # list another worktree's sessions
picobu sessions tree            # session tree: roots with their sub sessions
picobu sessions rename <id> "New title"
picobu sessions delete <id>     # reports the cascade count
```

### Session states

Every session carries a lifecycle state, persisted in its meta sidecar: `running` (a run is in flight), `waiting` (a blocking flow tool — `ask`/`plan-write` — returned a pending output and the loop paused for the user), `finished`, or `error`.

### Session summary (`summarize`)

`session.summarize()` makes a one-shot model call over the whole conversation and returns the summary (plus that call's usage and cost). It is read-only — the session's history is never touched. (Compaction, by contrast, replaces the history.)

### Checkpoints: undo & redo

Every `write` and `edit` records a checkpoint (the file's before/after content) in `<folder>/<sessionId>/checkpoints.jsonl`. `session.undo()` / `session.redo()` replay those records directly on disk — no LLM call — and are refused while a run is in progress or the session errored. A new edit discards the redo tail. Shell mutations are deliberately not checkpointed (documented limitation), so their effects are not undoable.

### Sub sessions & spawn

Agents with the `spawn` tool (the `coder` agent has it) can delegate work to **sub agents** — isolated sub sessions whose costs roll up into the parent. Subagent definitions are markdown files with `name`/`description`/`tools`/optional `model` frontmatter, discovered from built-ins (`executor`, `explorer`, `reviewer`) and `.agents/agents/*.md` (project files override built-ins by name):

```markdown
---
name: Explorer
description: Fast codebase exploration agent
tools: read, grep, glob, shell
---
You are a file search specialist. ...
```

- **`spawn` is blocking**: the step waits until every spawn call settles; parallel spawns in one step run concurrently.
- **`maxAgents`** (`harness.maxAgents`, default 4) caps concurrent sub sessions tree-wide and depth-inclusively (roots never count). Over-capacity root spawns **queue FIFO**; a nested spawn (the caller already holds a slot) **fails fast** instead of queueing, so blocked holders can never deadlock the queue. `0` disables spawning.
- **Depth cap 3**: a sub session cannot spawn deeper, spawn itself, or spawn an ancestor.
- **Sub agents cannot interact with the user**: the interactive flow tools (`ask`, `plan-write`, `plan-exit`) are never registered for sub sessions regardless of frontmatter, and a shared `Subagent Rules` block instructs them to resolve ambiguities autonomously and report back — the last text message is the deliverable, summarized and returned to the caller as the spawn result (`{ summary, usage }` with itemized token/cost usage).
- **Job registry**: `manager.jobs()` / `manager.onJobs(listener)` expose running/queued sub sessions so a future UI can render them as jobs; `abortJob(id)` cancels one.

### Cost accounting

`session.usage` stays **last-run** (it feeds the status bar and auto-compaction). `session.totals` is the lifetime view — cumulative tokens and cost across every run **and** sub session, with an itemized `costDetails` breakdown (`totalCost`, `inputCost`, `outputCost`, `cacheCost`, plus one entry per run/sub agent). Totals persist in the meta sidecar on every settle; a hard crash can lose the tail since the last settle (accepted).

### Sandbox & per-session cwd

Each session runs its tools inside a local sandbox rooted at the session's cwd (AI SDK `experimental_sandbox`, implemented over Bun): `shell` commands execute through your detected shell inside that root, and relative file paths in `read`/`write`/`edit`/`glob`/`grep` resolve against it (absolute paths pass through — no jail in v1). Abort signals kill running shell commands. `setSandbox(false)` is a runtime kill switch applying to sessions created afterwards. Skills/workflows/rules/AGENTS.md discovery still reads the bootstrap cwd at startup.

### Session compaction

When a session's used context (input + output tokens) reaches **80% of the current model's context window**, the session is compacted automatically after the run settles: the whole conversation is sent to the **currently running model** with a compactor prompt, and the resulting summary becomes the first message of a **new session**. The original session stays fully saved on disk.

### Login & OAuth

`startLogin(id)` authenticates a subscription provider OAuth — **OpenAI** (ChatGPT), **Anthropic** (Claude Pro/Max), or **GitHub Copilot** — so you can run models without API keys.

On success the OAuth credential is stored in `~/.picobu/auth.json` (never in `options.json`), and the provider is registered into `~/.picobu/options.json` the same way env-gated providers are (`apiKey: "auth:<id>"`, models from the models.dev catalog via `@opencode-ai/models`):

| Provider | `type` | Notes |
| --- | --- | --- |
| `openai` | `openai` | ChatGPT browser OAuth (PKCE, local callback); models from the models.dev `openai` catalog |
| `anthropic` | `anthropic` | Claude browser OAuth (PKCE, local callback); models from the models.dev `anthropic` catalog |
| `github-copilot` | `openai-compatible` | Device-code flow; base URL and usable models depend on the account/token (fetched from `/models`) |

Credentials auto-refresh at bootstrap and before every run; if a provider is first-time-logged-in it also becomes `harness.defaultModel`. `fixHarnessAfterLogout` removes the credential from `auth.json`, the provider (and its models) from `options.json`, and repoints any harness model selectors at a remaining provider.

## MCP (Model Context Protocol)

Picobu connects to [MCP](https://modelcontextprotocol.io/) servers and merges their tools into every agent loop, via `@ai-sdk/mcp`. Servers are configured globally in the `mcp` block of `~/.picobu/options.json` and/or per project in a `.mcp.json` file in the working directory (Claude-style `mcpServers` map; project entries win on id collision):

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

- **Transports**: `http` (recommended), `sse`, and `stdio` (local servers only — the command runs on this machine). `headers` and stdio `env` values accept `"env:VAR"` refs, resolved at connect time.
- **Login**: servers with `"auth": true` use MCP OAuth — `picobu mcp login <serverId>` opens the browser (PKCE, localhost callback on port 19888) and stores tokens in `~/.picobu/mcp-auth.json`. Tokens are refreshed at connect; `picobu mcp` lists every server with its connection and auth status (`auth: active` / `login needed` / `none`), and `picobu mcp logout <serverId>` drops the stored tokens.
- **Discovery**: tools are listed automatically from each server (schema discovery). Tool names are namespaced `mcp_<serverId>_<toolName>` (sanitized, capped at 64 chars) so they can't collide with built-in tools; agents that run all tools get MCP tools automatically, and agents with explicit tool lists opt in by namespaced name.
- **System prompt**: each server's tools are documented in the `<Tools>` section like built-in tools — server description + JSON schema — optionally preceded by the config's `instructions` note (or the server's own initialize-time instructions).
- **Sessions**: each session owns its MCP clients (connected lazily on first use, closed on `session.close()`); Streamable HTTP sessions reattach instead of re-initializing. `session.mcp` exposes per-server snapshots, the current tool names, and `refresh()` for mid-conversation re-discovery (the prompt-cache prefix is only invalidated when the tool set actually changes).
- **Elicitation**: the capability is advertised; servers requesting user input mid-tool-call are answered with an automatic **decline** (no interactive UI in the headless core yet).

## Agents

| Agent | Role |
| --- | --- |
| `ask` | Fast Q&A, runs on the `flash` role |
| `coder` | The default coding loop, runs on the `flash` role |
| `plan-code` | Deep planning + implementation, runs on the `heavy` role |
| `persistent` | Fresh, stateless 10-step runs per prompt |

Coding runs are capped at **100 steps** as a safety limit (each tool call round-trip is a step; the `ask`/`plan-write` interrupts pause before a new step starts).

Project instructions are loaded automatically: when a session starts, the system prompt embeds the `AGENTS.md` (or `CLAUDE.md`) from the working directory, appended at the end of the guidelines section — no need to ask the agent to read it.

## Tools

Tools are grouped in families:

- **filesystem** — `read` / `write` / `edit` (file I/O with diffs; writes and edits record undo checkpoints), `glob` / `grep` (search, ripgrep-backed), `shell` (shell execution using your detected shell, cancellable via abort). `glob` and `grep` respect `.gitignore`, except that agent config folders — `.agents/` in the project and home, plus `~/.picobu/{skills,workflows,prompts,commands,rules}` — are always included, even when dot-prefixed or gitignored.
- **flow** — session workflow state.
  - `todo`: one todo list per session, persisted at `<folder>/<sessionId>/session-todo.json` and fully rewritten on every call. Actions: `ins` (append items), `upd` (replace by index), `del` (remove by index).
  - `skill` (non-interrupting): loads a discovered skill by name. The output carries the skill's frontmatter-stripped SKILL.md body plus its folder path and the relative paths of the related files in it, which the agent then reads with `read` as the instructions reference them. The system prompt lists every installed skill's name and description (a `<Skills>` section) so the agent knows when to reach for it — task matches the description or the user asks for it by name.
  - `rule` (non-interrupting): loads a discovered rule by name — modular instructions for specific cases (e.g. a `testing.md` rule whose description says it applies when generating tests). Rules are flat markdown files with `name`/`description` frontmatter, discovered from `.agents/rules`, `~/.picobu/rules`, and `~/.agents/rules` in that precedence order. The system prompt lists every installed rule's name and description (a `<Rules>` section) so the agent loads the ones whose description matches the current task.
  - `ask` (interrupting): asks the user up to 5 structured questions; the run pauses after the call so the host frontend can collect answers and deliver them back as a follow-up prompt.
  - `plan-exit` (non-interrupting): handoff tool signalling the switch from the Plan agent to the Coder agent mid-run so the approved plan is implemented immediately.
  - `plan-write` (interrupting): submits the finished plan for review; the run pauses so the host frontend can present it and send comments or approval back as the next prompt.
  - `spawn` (blocking, non-interrupting): runs a subagent as an isolated sub session and waits for its final report (see [Sub sessions & spawn](#sub-sessions--spawn)). Registered only for agents that list `spawn` in their `tools` (the `coder` agent); the system prompt carries a `<Subagents>` section with the catalog.
- **external** — web access via headless Chrome (Puppeteer), so JavaScript-rendered pages are captured correctly; requests carry a real-Chrome identity (UA + client hints, `navigator.webdriver` scrubbed) to avoid bot-protection blocks. `websearch` queries DuckDuckGo's HTML endpoint — `query` plus `deepness` (result pages, 1–5), paginated via the `s` offset; every link found across those pages is fetched and its content attached as Markdown. `webfetch` fetches a URL and returns its contents as Markdown (HTML pages are converted with turndown; other content types pass through verbatim).

Every tool carries a JSON Schema rendered into the system prompt.

Skills, workflows, prompts, and commands are markdown files (flat-YAML frontmatter) discovered from `.agents/skills`, `.agents/workflows`, `.agents/prompts`, and `.agents/commands` — checked in your project, `~/.picobu`, and home, in that precedence order.

## Project layout

```
src/
├── cli.ts                 # CLI entry point (`picobu`, `sessions` + subcommands) + background-service bootstrap
├── agent/                 # Agent runtime: loop, sessions, model DI, agents registry, tools, prompts, commands
│   ├── loop/              # createLoop — the step engine (per-step getConfig)
│   ├── sessions/          # session facade, session manager, meta sidecar, checkpoints, prompt history
│   ├── model/             # provider resolver, catalogs (hyper, models.dev), registry, autoload
│   ├── agents/            # create-agent, registry (ask/coder/plan-code/persistent), subagents
│   └── tools/             # toolset + filesystem/, flow/, web/ tool families
├── config/                # options.ts — ~/.picobu/options.json types, load/persist/migrate, model roles
├── shared/                # lock, notify, shell, error-report, format, filetype, open-url, text-stats
├── auth/                  # OAuth login flows, credential store, provider registration
├── integrations/          # WhatsApp (Baileys) connection, bus, contacts, actions + wwp tools; MCP
└── tui/                   # 44 bundled themes (resolveTheme/generateSyntax) for host frontends
```

### Path aliases

Every `src/` folder is importable as `@<folder>` via the `paths` map in `tsconfig.base.json`: `@agent/*`, `@auth/*`, `@config/*`, `@integrations/*`, `@shared/*`, `@tui/*`. Imports use aliases instead of relative specifiers, keeping the `.ts` extension (e.g. `import { options } from "@config/options.ts"`). Bun and `tsc` both resolve them, so no build step is needed.

## Tech stack

Vercel AI SDK (`ai`, `@ai-sdk/*`) · XState Store · Zod · Bun
