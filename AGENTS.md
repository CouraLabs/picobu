# Repository Guidelines

## Project Overview

PICOBU is a headless autonomous coding agent core. One agent loop — read, plan, edit — exposed as a library and a minimal CLI (`src/cli.ts`), built on the Vercel AI SDK. Host frontends (TUI, web, chat bot) attach on top; the WhatsApp integration (Baileys) ships in-repo. There is no UI in this repo: the default command bootstraps providers, OAuth, and WhatsApp, then reports ready.

## Architecture & Data Flow

- `src/cli.ts` — commander-based entry: `picobu` (bootstrap + "headless core ready") and `picobu sessions` (list saved sessions for the current folder). Bootstrap runs `autoloadLlmProviders()` (merge env-gated custom providers into `options.json`), `ensureOAuthTokens()` (refresh expired OAuth credentials), and `connectToWhatsApp()` when `whatsapp.enabled`.
- `createLoop` (`src/agent/loop/create-loop.ts`) builds a `ToolLoopAgent` from a `getConfig` closure — the model, tools, sectioned system prompt, and thinking effort are re-resolved from config **every step**, so host apps can change agent/model mid-conversation without rebuilding the loop. The loop owns the conversation and returns usage/metadata for the host to persist.
- WhatsApp flow: inbound messages from allowed numbers hit the `bus` (`src/integrations/whatsapp/bus.ts`) and are submitted to the persistent session; agent-sent texts carry a zero-width-space sentinel and are dropped when they echo back (`fromMe` upsert).
- Sessions are saved incrementally to `~/.picobu/sessions/<folder>/<sessionId>.jsonl` (`src/agent/sessions/session.ts`). When a run's used context hits **80% of the model's context window** (and the session opts into `autoCompact`) it is auto-compacted after settling (`compactSession` in the same module + `prompts/compactor.ts`): the conversation is summarized by the current model and a compaction **cut** message is appended — pre-cut messages stay saved but never reach the LLM again; `uncompact` restores them and `SessionManager.forkSession` clones a session (at the last cut with `fromCompaction`).

## Key Directories

- `src/agent/` — agent runtime. `model/` (`resolver.ts` model DI; hyper + models.dev catalogs `catalog-hyper.ts`/`catalog-models-dev.ts`, `fetch-models.ts`, `autoloadLlmProviders` in `registry.ts`); `agents/` create-agent + `registry.ts` — agents `ask`, `coder`, `plan-code`, `persistent` + `types.ts`; `loop/create-loop.ts`; `sessions/` (`session.ts` — session facade (chat + switchers + persistence/compaction/title), `session-manager.ts`, `session-meta.ts`, `checkpoints.ts`, `prompt-history.ts`); `tools/` (`toolset.ts` + `filesystem/` read/write/edit/glob/grep/bash + `agent-dirs.ts`, `web/` websearch/webfetch + shared `browser.ts` and `html-to-markdown.ts`, `flow/` todo|ask|skill|rule|plan-exit|plan-write|spawn); `prompts/` (ask/coder/plan/persistent/compactor/agents-md TS templates + sectioned `system.ts` + `embeds.ts`); `markdown/` (frontmatter parser); `subagent/` (executor/explorer/reviewer prompts); `rules/` (`rules.ts` — rule discovery for the `<Rules>` section); `commands/` (index + discovery + types — markdown skills/workflows/prompts/commands discovery).
- `src/config/` + `src/shared/` — `config/options.ts` (config types/defaults, load/persist/migrate `~/.picobu/options.json`, `resolveModelRole`); `shared/` holds `lock.ts` (cross-instance file locking, `withLock`), `shell.ts` (shell detection), `error-report.ts` (normalize thrown values + AI SDK `AI_APICallError` into a user-facing report), `notify.ts`, `filetype.ts`, `format.ts`, `text-stats.ts`, `open-url.ts`. Session persistence, compaction, and titles live in `src/agent/sessions/session.ts`.
- `src/auth/` — OAuth for OpenAI (PKCE browser flow), Anthropic (PKCE), and GitHub Copilot (device-code flow): `store.ts` (`~/.picobu/auth.json`), `register.ts` (provider + models from the models.dev catalog into `options.json`, `apiKey: "auth:<id>"`), `index.ts` (orchestration, credential refresh at startup and before every run, `fixHarnessAfterLogout` repointing).
- `src/integrations/whatsapp/` — Baileys integration: `connection` (reconnect from persisted credentials), inbound `bus`, `contacts`, `phone` normalization, `actions`, `deliver`, `whatsapp-store`, `wwp-tools.ts` (the `wwp-*` agent tools).
- `src/tui/` — `themes/index.ts`: 44 JSON palettes in `themes/assets/`, `Theme` type, contrast-aware `resolveTheme`/`generateSyntax`. `src/tui/app.ts` is an empty placeholder.

## Path Aliases

Every `src/` folder is importable as `@<folder>` (see `paths` in `tsconfig.json`): `@agent/...`, `@auth/...`, `@config/...`, `@integrations/...`, `@shared/...`, `@tui/...`. Use aliases for **all** imports instead of relative specifiers (keep the `.ts` extension: `import { options } from "@config/options.ts"`). When adding a new top-level folder under `src/`, add its alias to `tsconfig.json`.

## Development Commands

```bash
bun install        # install dependencies (Bun is the only package manager; bun.lock)
bun dev            # run the bootstrap (providers, OAuth refresh, WhatsApp)
bun run tsc        # type-check (tsc -noEmit) — the only verification gate
bun test           # run tests (bun:test discovery of *.test.ts; no npm test script)
```

- No build step, bundler, linter, formatter, or CI config exists — do not introduce one without asking.

## Code Conventions & Common Patterns

- **Error handling**: throw `new Error(...)` inside tools and resolvers — the AI SDK surfaces them as `errorText` to the host (see `edit.ts` refusing ambiguous replaces). `try/catch` only around best-effort side effects (notify → return null). No Result monads; normalize provider errors through `shared/error-report.ts`.
- **Async**: `async`/`await` throughout. Tool handlers may return `Promise | AsyncIterable | ReadableStream` (e.g. `writeTool` streams content + `\n<N> lines written` trailer). Wrap file mutations in `withLock(path, fn)` from `@shared/lock.ts`.
- **DI (no framework)**: module-level `options` singleton (loaded at import in `@config/options.ts`) consumed everywhere; models resolved per call via `resolveModel(modelKey)` using AI SDK factories (`createAnthropic`/`createOpenAICompatible`/`createOpenResponses`) keyed by provider `type`; `"env:VAR_NAME"` and `"auth:<id>"` apiKey refs resolved at construction; agents statically registered in `@agent/agents/registry.ts` (`AGENTS: Record<string, AgentType>`); the loop takes a `getConfig` closure so per-step config stays live. OAuth providers are statically registered in `@auth/index.ts` (`OAUTH_AUTHS`).
- **Zod schemas**: every tool exports `XxxToolArgsSchema` / `XxxToolOutputSchema` (`z.object`); `wrapTool` (`tool/toolset.ts`) converts to AI SDK `tool()` and renders `z.toJSONSchema` into the system prompt. Tests pin args with `satisfies z.infer<typeof XxxToolArgsSchema>`.
- **File naming**: modules are camelCase/kebab-case, one case per directory, never mixing. A file's directory must not simply restate the file name (use `tool/filesystem/read.ts`, not `tool/filesystem/read/read.ts`). Tests live in the top-level `test/` folder, mirroring `src/` module folders (`src/agent/tools/flow/ask.ts` → `test/agent/tools/flow/ask.test.ts`).
- **Markdown as config**: agents, skills, workflows, and commands are markdown with flat-YAML frontmatter parsed by `@agent/markdown/markdown-parser.ts` (key: value only; supports `{PARAM}` substitution). Frontmatter fields in use: `name`, `description`, `tools` (comma list; `*` = all), `model`, `category`, `color`. System prompt is sectioned by `#` headings (`prompts/system.ts`).
- **Bun-first APIs**: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.Glob`; ripgrep via `@vscode/ripgrep` `rgPath`; diffs via `diff` package `createTwoFilesPatch`; headless Chrome for web tools via Puppeteer.
- **TypeScript**: strict + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`; `verbatimModuleSyntax` (use `import type`); `module: Preserve` + bundler resolution + `allowImportingTsExtensions` (import with `.ts` extensions); `allowJs`.

## Important Files

- `src/cli.ts` — CLI entry + background-service bootstrap.
- `src/config/options.ts` — config types/defaults, `~/.picobu/options.json` load/persist, legacy `defaults.model` → `harness.defaultModel` migration, `resolveModelRole` defaults (tiny: none, flashThinking: medium, heavyThinkingLevel: high).
- `src/agent/sessions/session.ts` — the session facade (`createSession` over `createLoop`: chat contract + `switchAgent`/`switchModel`/`switchThinking`, `queue` (one-at-a-time dispatch after each run settles) and `steer` (abort in-flight run, jump the queue), `abort` (stop the run + drop the queue), `init.id` resumes a saved session's messages, chat id = session id, auto-persisted, introspection getters (`skills`/`workflows`/`rules`/`agents`/`usage` — tokens, TPS, TTFT, cost of the last run), `stream()` (async generator of the run's `UIMessageChunk`s via a transport tee)) plus the merged session modules: JSONL persistence (dedupe/sanitize/tombstones), 80%-context compaction, and session-title generation.
- `src/shared/error-report.ts` — user-facing error normalization for AI SDK provider failures.
- `src/auth/index.ts` + `src/auth/store.ts` — OAuth login/logout orchestration, `~/.picobu/auth.json` credential store.
- `src/agent/model/resolver.ts` + `model/registry.ts` — model DI, `env:`/`auth:` key resolution, provider/model catalogs, `autoloadLlmProviders`.
- `src/agent/loop/create-loop.ts` — `ToolLoopAgent`, per-step `getConfig`, system-prompt cache.
- `src/agent/tools/toolset.ts` + `filesystem/` — tool registration pattern and the filesystem tools.
- `src/agent/commands/discovery.ts` + `index.ts` — slash-command/skill/workflow catalog from markdown roots.
- `README.md` — the user-facing documentation; keep it in sync with behavior changes.

## Runtime/Tooling Preferences

- **Runtime**: Bun ≥ 1.x required — no Node. ESM (`"type": "module"`), `"module": "src/cli.ts"`.
- **Package manager**: Bun (`bun.lock`). Never commit `package-lock.json`/`yarn.lock`.
- **Stack**: AI SDK 7.x (`ai`, `@ai-sdk/*`, zod 4), `@vscode/ripgrep`, `diff`, puppeteer (headless Chrome for web tools), turndown (HTML→Markdown), `@whiskeysockets/baileys` (WhatsApp), `@opencode-ai/models` (provider model catalogs), `commander` (CLI parsing), `pino`, `@opentui/core` (theme types + palettes), `@xstate/store`. TypeScript ^7 is a peer dep.
- **User config**: `~/.picobu/options.json` (auto-created as `{}`) — blocks: `providers` (type `anthropic | openai-compatible | openai-responses | openai`, models with context/output/reasoning/efforts/billing), `harness` (`defaultModel` `"<providerId>/<modelId>"` + `modelRoles`), `whatsapp` (`enabled`, `allowedNumbers`). OAuth credentials live separately in `~/.picobu/auth.json`; sessions in `~/.picobu/sessions/`; prompt history in `~/.picobu/prompt-history.json`.
- **Model roles**: `tiny` (thinking none), `flash` (ask + coder; model's `defaultEffort`), `heavy` (plan-code; `heavyThinkingLevel` → high). Coding runs cap at 100 steps; the persistent agent runs fresh 10-step runs per prompt.
- `.commandcode/` is gitignored local editor-sandbox config (shell allow-list for the dev server), not repo runtime code.

## Testing & QA

- **Framework**: `bun:test` (`describe`/`test`/`expect` from `"bun:test"`; `@types/bun` in devDeps). Run with `bun test test/` (the `test` script) or `bun test test/<path>`. Tests live in `test/` (mirroring `src/` module folders), type-checked via `tsc -noEmit -p tsconfig.test.json` (`tsc:test` script); `bun run tsc` checks only `src/`.
- **Conventions**: colocate `foo.test.ts` next to `foo.ts`; async callbacks; exact-equality assertions (`toBe`) against real filesystem state; temp-dir isolation (`mkdtemp` in `tmpdir()`, cleaned in `finally { rm(dir, {recursive: true, force: true}) }`); no mocks/fixtures/snapshots.
- **Coverage**: 335 tests across 43 files. Tested surface: auth (PKCE, device-code polling, OpenAI/Anthropic/Copilot flows, credential store, provider registration/repointing); the LLM provider registry; the system prompt sectioning + `<Skills>`/`<Rules>` sections + `rules.ts`; flow tools (`todo` persistence, `ask` args/handler, `skill` loading + unknown-name errors, `rule`, `plan-exit` picker switch, `plan-write`); `write` tool stream contract; agent-dir visibility helpers, `glob`/`grep` gitignore + agent-dir behavior (real git repos in temp dirs); external tools (Chrome identity, html-to-markdown, websearch parsing, webfetch e2e); WhatsApp (contacts, inbound bus, phone normalization); session module (`compactor` threshold + serialization, `sessions` save/load/dedupe/sanitize/tombstones/`listSessions`, `createSession` facade: switchers, chat-id = session-id, `prompt-history`, `format`); themes (all 44 palettes resolve and pass contrast checks in both variants). Still untested: read/edit/bash handlers, markdown parser, lock layer, `error-report`.
- **QA gate**: `bun run tsc` is the only project-wide check. When changing behavior, follow the write-test example: deterministic, isolated, end-to-end against the observable contract.
