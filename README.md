# PICOBU

A headless autonomous coding agent core. One agent loop — read, plan, edit — exposed as a library and a minimal CLI, built on the Vercel AI SDK. Attach your own frontend (TUI, web, chat bot) on top, or drive it from the WhatsApp integration and cron scheduler that ship in-repo.

## Requirements

- [Bun](https://bun.sh) ≥ 1.x

## Getting started

```bash
bun install       # install dependencies
bun dev           # run the bootstrap (providers, OAuth refresh, cron scheduler, WhatsApp)
picobu sessions   # list saved sessions for the current folder
```

Type-check with `bun run tsc`; run tests with `bun test`.

## Configuration

Everything lives in `~/.picobu/options.json` (auto-created as `{}` on first run). Top-level blocks:

| Key | Purpose |
| --- | --- |
| `providers` | AI providers and their models, billing, and capabilities |
| `harness` | `defaultModel` (`"<providerId>/<modelId>"`) plus per-role model/thinking overrides |
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

## WhatsApp

The Baileys integration (unofficial WhatsApp Web API) lives in `src/integrations/whatsapp/`. When `whatsapp.enabled` is set, `connectToWhatsApp()` is called at bootstrap and reconnects from persisted credentials under `~/.picobu/whatsapp/auth` without a QR. `allowedNumbers` lists the phone numbers allowed to talk to the agent (empty = nobody; outbound sending still works). Inbound messages from allowed numbers are submitted to the persistent session, which can reply and act using the `wwp-*` tools. Agent-sent texts are prefixed with an invisible zero-width-space sentinel; when that outbound message echoes back into the socket (`fromMe` upsert), it is recognized by the sentinel and dropped.

The same operations are exposed to the persistent agent as tools (`wwp-msg`, `wwp-alert`, `wwp-list-alerts`, `wwp-rm-alert`, `wwp-today`, `wwp-reminder`, `wwp-list-reminders`, `wwp-rm-reminder`), so the agent can send messages and manage alerts, reminders, and tasks itself. Alerts and reminders are evaluated by the cron scheduler.

## Crons

Jobs persist in `~/.picobu/crons.json` and run while the process is open, evaluated on a 30s sweep (`startCronScheduler()`); each job carries a schedule (interval or daily `HH:MM`) and an action — a WhatsApp message, a desktop notification, or a prompt to the persistent agent.

## Sessions

Every run is saved incrementally (per message) to `~/.picobu/sessions/<folder>/<id>.jsonl` — `<folder>` is the sanitized name of the working directory, `<id>` the 16-hex session id. A session is only saved **after its first prompt** — an untouched session leaves no file behind. Saved sessions are listed with `picobu sessions`. The persistent agent keeps its own 10-step cap per prompt.

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

- **filesystem** — `read` / `write` / `edit` (file I/O with diffs), `glob` / `grep` (search, ripgrep-backed), `bash` (shell execution using your detected shell). `glob` and `grep` respect `.gitignore`, except that agent config folders — `.agents/` in the project and home, plus `~/.picobu/{skills,workflows,prompts,commands,rules}` — are always included, even when dot-prefixed or gitignored.
- **flow** — session workflow state.
  - `todo`: one todo list per session, persisted at `<folder>/<sessionId>/session-todo.json` and fully rewritten on every call. Actions: `ins` (append items), `upd` (replace by index), `del` (remove by index).
  - `skill` (non-interrupting): loads a discovered skill by name. The output carries the skill's frontmatter-stripped SKILL.md body plus its folder path and the relative paths of the related files in it, which the agent then reads with `read` as the instructions reference them. The system prompt lists every installed skill's name and description (a `<Skills>` section) so the agent knows when to reach for it — task matches the description or the user asks for it by name.
  - `rule` (non-interrupting): loads a discovered rule by name — modular instructions for specific cases (e.g. a `testing.md` rule whose description says it applies when generating tests). Rules are flat markdown files with `name`/`description` frontmatter, discovered from `.agents/rules`, `~/.picobu/rules`, and `~/.agents/rules` in that precedence order. The system prompt lists every installed rule's name and description (a `<Rules>` section) so the agent loads the ones whose description matches the current task.
  - `ask` (interrupting): asks the user up to 5 structured questions; the run pauses after the call so the host frontend can collect answers and deliver them back as a follow-up prompt.
  - `plan-exit` (non-interrupting): handoff tool signalling the switch from the Plan agent to the Coder agent mid-run so the approved plan is implemented immediately.
  - `plan-write` (interrupting): submits the finished plan for review; the run pauses so the host frontend can present it and send comments or approval back as the next prompt.
- **external** — web access via headless Chrome (Puppeteer), so JavaScript-rendered pages are captured correctly; requests carry a real-Chrome identity (UA + client hints, `navigator.webdriver` scrubbed) to avoid bot-protection blocks. `websearch` queries DuckDuckGo's HTML endpoint — `query` plus `deepness` (result pages, 1–5), paginated via the `s` offset; every link found across those pages is fetched and its content attached as Markdown. `webfetch` fetches a URL and returns its contents as Markdown (HTML pages are converted with turndown; other content types pass through verbatim).

Every tool carries a JSON Schema rendered into the system prompt.

Skills, workflows, prompts, and commands are markdown files (flat-YAML frontmatter) discovered from `.agents/skills`, `.agents/workflows`, `.agents/prompts`, and `.agents/commands` — checked in your project, `~/.picobu`, and home, in that precedence order.

## Project layout

```
src/
├── cli.ts               # CLI entry point (`picobu`, `sessions`) + background-service bootstrap
├── harness/             # Agent runtime: providers, agent factory, loop, prompts, toolset, commands
├── libs/                # options, lock, shell, sessions, embeds, compactor, notify, text stats, filetype
├── auth/                # OAuth login flows, credential store, provider registration
├── cron/                # schedule parsing + 30s sweep scheduler
└── integrations/        # WhatsApp (Baileys) connection, inbound bus, contacts, actions
```

## Tech stack

Vercel AI SDK (`ai`, `@ai-sdk/*`) · XState Store · Zod · Bun
