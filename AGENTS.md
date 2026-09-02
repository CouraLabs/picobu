# Repository Guidelines

## Project Overview

PICOBU is an autonomous coding agent that lives in your terminal: type a prompt and it reads, plans, and edits your project step by step, with live tool-call rendering and per-run token/cost metrics. One React app serves two frontends — a native TUI (OpenTUI over Bun) and a browser client (xterm.js over a Bun HTTP+WebSocket server). Around the coding loop sit four more surfaces: a WhatsApp integration (Baileys), a Pomodoro timer, a cron scheduler, and a 3D page. Built on the Vercel AI SDK, XState Store, and Zod; scaffolded with `bun create tui`.

## Architecture & Data Flow

Two entry points feed one React app via `startPicobu(renderer, opts)` in `src/app.tsx`, which creates per-session `SessionBindings` and renders `<SessionBindingsProvider><DialogProvider><App/></DialogProvider></SessionBindingsProvider>`:

- `src/cli.ts` — commander-based CLI entry (`picobu`, `picobu --web`, `picobu --session <id>`, `picobu sessions`); routes to `startTui` (`src/tui.ts`, OpenTUI renderer) or `startServer` (`src/server.ts`). Bootstrap runs `autoloadLlmProviders()` (provider-model catalogs) and `ensureOAuthTokens()` (credential refresh) before starting either.
- `src/server.ts` — Bun HTTP+WS server (`bun run web`); serves the xterm.js client bundled in `src/web/index.ts`, one `CliRenderer` per WebSocket tab (binary frames = ANSI renderer output, JSON `{type:'resize',cols,rows}` frames in, raw keyboard bytes in).
- `src/app.tsx` — `App` owns page routing (SESSIONS / WHATSAPP / POMODORO / CRONS / 3D) and the coding tab (`coding` | `persistent`); the tab survives page switches and `/new`/`/sessions`/`/cd` swap the session id, remounting the per-session provider.

Prompt flow: `Prompt` textarea → `usePromptClipboard.resolveAndClear` (paste → embed tokens) → `CodingSessionContext.onPrompt` → `/`-commands resolved via `resolveCommandPrompt` (system commands mutate `loopStore`; skills/workflows are rewritten into prompts) or direct submit → `sendMessage({text, files})` on `useChat` with the `DirectChatTransport` from `createLoop`.

`createLoop` (`src/harness/agent/factory/loop/create-loop.ts`) builds a `ToolLoopAgent` whose `prepareCall` re-resolves the model, active tools, cached sectioned system prompt, and thinking effort from the live `loopStore` snapshot **every step** — so agent/model/thinking switches mid-conversation need no new loop. Tool parts stream back into `useChat` messages and are converted by `toolPartToModel` (`tool-model-parser.ts`) into a discriminated `ToolCallModel` rendered by per-tool variant components in `src/components/session/tools/` (exhaustive switch + `assertNever`).

State split: global singleton XState stores (`loopStore`, `themeStore`, `settingsStore`, `footerToastStore`, `clipboardStore`, `interactionStore`, `authStore`, `compactionStore`, `sessionTitleStore`, `pomodoroStore`) hold UI + loop config; the run itself (messages/status/metrics) lives in the per-session React context (`CodingSessionContext` in `providers/SessionProvider.tsx`, `PersistentSessionProvider.tsx`), so in-flight runs survive page switches. Settings writes go through `saveSettings` → `updateSettings` with `withLock` on `~/.picobu/options.json`; tool file mutations are serialized with `withLock`; run completion fires desktop notifications via `src/libs/notify.ts`.

Sessions are saved incrementally to `~/.picobu/sessions/<folder>/<sessionId>.jsonl` (`src/libs/sessions.ts`) and resumable with `--session` or `/sessions`. When a run's used context hits **80% of the model's context window** it is auto-compacted after settling (`src/libs/compactor.ts` + `prompts/compactor.ts`): the conversation is summarized by the current model and the summary seeds a new session; `/compact` triggers it manually.

## Key Directories

- `src/libs/` — `options.ts` (config types/defaults, load/persist/migrate `~/.picobu/options.json`, `resolveModelRole`), `lock.ts` (process-bound file locking), `shell.ts` (shell detection), `sessions.ts` (folder keys, JSONL save/load with dedupe/sanitize, prompts), `session-title.ts`, `prompt-history.ts` (rolling 10-prompt history), `compactor.ts` (80%-context compaction + tool-part serialization), `embeds.ts` (`T#N`/`F#N` prompt tokens), `notify.ts`, `clipboard.ts`, `filetype.ts` (ext→OpenTUI syntax map), `format.ts` (`clip`, `relTime`, `fmtTokens`, `fmtCost`), `text-stats.ts`, `open-url.ts`.
- `src/stores/` — global XState singleton stores: `loop-store` (agent/model/thinking pickers + `agentRoleConfig`), `theme-store`, `settings-store` (+ `saveSettings`), `footer-toast-store`, `clipboard-store`, `interaction-store` (ask answers + plan-review state keyed by session/part), `auth-store`, `compaction-store`, `session-title-store`, `pomodoro-store` (timer state machine). `coding-store.ts` is legacy/unused.
- `src/auth/` — OAuth: `/login` for OpenAI / Anthropic (PKCE browser flow) and GitHub Copilot (device-code flow), `store.ts` (`~/.picobu/auth.json`), `register.ts` (provider + models from the models.dev catalog into `options.json`, `apiKey: "auth:<id>"`), `index.ts` (orchestration, credential refresh at startup and before every run, `/logout` repoints selectors).
- `src/cron/` — `schedule.ts` (interval/daily frequency parsing + `isDue`) and `cron-store.ts` (30s sweep, jobs persisted in `~/.picobu/crons.json`).
- `src/integrations/` — `whatsapp/` (Baileys: `connection`, inbound `bus`, `contacts`, `phone` normalization, `actions`, `deliver`, `whatsapp-store`) plus a 0-byte legacy stub `whatsapp-integration.ts`; `src/integrations/whatsapp/` is the live code.
- `src/harness/` — agent runtime. `agent/factory/` (`provider-resolver.ts` model DI; `llm-providers/` hyper + models.dev catalogs, `fetch-models`, `autoloadLlmProviders`; `agent/` create-agent, `registry.ts`, color; `loop/create-loop`); `agent/tool/` (`toolset.ts`, `tool-model-parser.ts`, `filesystem/` read/write/edit/glob/grep/bash, `external/` websearch + webfetch + shared `browser.ts` and `html-to-markdown.ts`, `flow/` todo|ask|plan-exit|plan-write, `integration/wwp.ts` — 8 `wwp-*` tools); `agent/prompts/` (ask/coder/plan/persistent/system/compactor TS templates); `agent/markdown/` (frontmatter parser); `agent/subagent/` (executor prompt); `agent/types/`; `agent/skills/` + `agent/workflow/` — empty dirs; `commands/` (index, discovery, bindings, types, `system/` quit|models|effort|model-roles|new|sessions|cd|compact|login|logout, `whatsapp/` — the `/wwp:*` family).
- `src/providers/` — `SessionProvider.tsx` (CodingSessionContext: loop + useChat + metrics + notifications), `PersistentSessionProvider.tsx` (fresh per-prompt 10-step sessions), `SessionBindings.tsx`, `DialogProvider.tsx`, `session-run.ts` (shared `RunSession` contract, `messageMetadataSchema`, `makeStop`).
- `src/hooks/` — `useRunMetrics`, `useLoopKeybinds` (swallows all keys mid-stream), `useGitStatus`, `useClipboard`/`usePromptClipboard`, `useCopyToClipboard` (OSC 52), `useCopyableMessage`, `useSession`, `useRunCompletionNotification`, `usePersistentSession`, `usePromptHistory`, `useDialog`, `useTheme`.
- `src/pages/` — `SessionPage` (coding + persistent tabs) and routed pages: `WhatsAppPage`, `PomodoroPage`, `CronsPage`, `ThreeDPage`.
- `src/components/` — `Header`/`Tabs`/`Theme`/`HelpDialog`; `session/` (ChatMessages, Prompt, ToolCall + per-tool renderers in `tools/`, pickers, `PlanReviewDialog` + `PlanReviewPrompt`, `ModelRoles`, `MotivationalPhrases`, `usePlanComments`); `ui/` (Button, InputField, Dialog); `symbols/` (icons, logo).
- `src/themes/` — `index.ts`: 44 JSON palettes in `assets/`, `Theme` type, contrast-aware `resolveTheme`/`generateSyntax` (selection ink derived from panel luminance), persisted `{key, variant}`.
- `src/web/` — `index.ts`: the xterm.js browser client bundled as a TS module (`INDEX_HTML` + inline scripts), served by `server.ts`.

## Development Commands

```bash
bun install        # install dependencies (Bun is the only package manager; bun.lock)
bun dev            # run the TUI (bun run --watch src/cli.ts)
bun run web        # browser client via xterm.js (bun run src/cli.ts --web)
bun run tsc        # type-check (tsc -noEmit) — the only verification gate
bun test           # run tests (bun:test discovery of *.test.ts; no npm test script)
```

- CLI: `picobu` (TUI), `picobu --web`, `picobu --session <id>` (resume; banner shown on TUI exit), `picobu sessions` (list saved sessions for the current folder).
- `HOST`/`PORT` env vars override `options.web`; `--web` and `--session` are mutually exclusive.
- No build step, bundler, linter, formatter, or CI config exists — do not introduce one without asking.

## Code Conventions & Common Patterns

- **XState stores** (`@xstate/store-react`): `createStore({ context: {...}, on: { action: (state, e) => ({...state, ...}) } })` with fresh spreads in reducers. Read in components via `useSelector(store, (s) => s.context.x)`; imperative reads via `store.getSnapshot().context`; mutate via `store.trigger.<action>({...})`. Cycling actions (`nextAgent`/`nextThinking`) wrap around with modulo.
- **Hooks**: `useX` naming; thin wrappers over stores/context returning plain objects; `useRef` for mutable timing/identity, `useCallback` for stable handlers.
- **Components**: plain functions (no memo); lowercase intrinsic OpenTUI elements (`box`, `text`, `scrollbox`, `textarea`, `spinner`, `markdown`, `code`) with flexbox layout; colors passed as props from the theme selector; icons from `components/symbols/icons`.
- **Error handling**: throw `new Error(...)` inside tools and resolvers — the AI SDK surfaces them as `errorText` → `ToolStatus` in the UI (see `edit.ts` refusing ambiguous replaces). `try/catch` only around best-effort side effects (notify, clipboard → return null). Exhaustive switches + `assertNever` for closed unions (`ToolCall.tsx`). No Result monads.
- **Async**: `async`/`await` throughout. Tool handlers may return `Promise | AsyncIterable | ReadableStream` (e.g. `writeTool` streams content + `\n<N> lines written` trailer). Wrap file mutations in `withLock(path, fn)` from `src/libs/lock.ts`.
- **DI (no framework)**: module-level `options` singleton (loaded at import in `libs/options.ts`) consumed everywhere; models resolved per call via `resolveModel(modelKey)` using AI SDK factories (`createAnthropic`/`createOpenAICompatible`/`createOpenResponses`) keyed by provider `type`; `"env:VAR_NAME"` and `"auth:<id>"` apiKey refs resolved at construction; agents statically registered in `factory/agent/registry.ts` (`AGENTS: Record<string, AgentType>`); the loop takes a `getConfig` closure so per-step config stays live. OAuth providers are statically registered in `auth/index.ts` (`OAUTH_AUTHS`).
- **Zod schemas**: every tool exports `XxxToolArgsSchema` / `XxxToolOutputSchema` (`z.object`); `wrapTool` (`tool/toolset.ts`) converts to AI SDK `tool()` and renders `z.toJSONSchema` into the system prompt. Tests pin args with `satisfies z.infer<typeof XxxToolArgsSchema>`.
- **File naming**: components, hooks (`useX`), and modules in `src/components/`, `src/pages/`, `src/providers/`, `src/hooks/`, `src/stores/`, `src/libs/` follow one case per directory — PascalCase for components (`Prompt.tsx`), camelCase/kebab-case for plain modules elsewhere; never mix within a directory. A file's directory must not simply restate the file name (use `tool/filesystem/read.ts`, not `tool/filesystem/read/read.ts`). Tests are colocated as `foo.test.ts`.
- **Markdown as config**: agents, skills, workflows, and commands are markdown with flat-YAML frontmatter parsed by `src/harness/agent/markdown/markdown-parser.ts` (key: value only; supports `{PARAM}` substitution). Frontmatter fields in use: `name`, `description`, `tools` (comma list; `*` = all), `model`, `category`, `color`. System prompt is sectioned by `#` headings (`prompts/system.ts`).
- **Bun-first APIs**: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.Glob`, `Bun.serve`; ripgrep via `@vscode/ripgrep` `rgPath`; diffs via `diff` package `createTwoFilesPatch`; headless Chrome for web tools via Puppeteer.
- **TypeScript**: strict + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`; `verbatimModuleSyntax` (use `import type`); `module: Preserve` + bundler resolution + `allowImportingTsExtensions` (import with `.ts` extensions); `jsxImportSource: @opentui/react`; `allowJs`.

## Important Files

- `src/cli.ts` / `src/tui.ts` / `src/app.tsx` — CLI entry, TUI renderer, shared `App` + `startPicobu`.
- `src/server.ts` + `src/web/index.ts` — web/xterm host, session-stream wiring (one picobu session per tab).
- `src/libs/options.ts` — config types/defaults, `~/.picobu/options.json` load/persist, legacy `defaults.model` → `harness.defaultModel` migration, `resolveModelRole` defaults (tiny: none, flashThinking: medium, heavyThinkingLevel: high).
- `src/libs/sessions.ts` + `src/libs/compactor.ts` — JSONL session persistence (dedupe/sanitize/tombstones) and 80%-context compaction.
- `src/auth/index.ts` + `src/auth/store.ts` — OAuth login/logout orchestration, `~/.picobu/auth.json` credential store.
- `src/harness/agent/factory/provider-resolver.ts` + `llm-providers/registry.ts` — model DI, `env:`/`auth:` key resolution, provider/model catalogs, `autoloadLlmProviders`.
- `src/harness/agent/factory/loop/create-loop.ts` — `ToolLoopAgent` + `DirectChatTransport`, per-step `getConfig`, system-prompt cache, Anthropic cacheControl 1h.
- `src/harness/agent/tool/toolset.ts` + `filesystem/` — tool registration pattern and the six filesystem tools.
- `src/harness/commands/discovery.ts` + `bindings.ts` + `system/` — slash-command catalog, `SessionBindings` (multi-session), and system commands.
- `src/providers/SessionProvider.tsx` + `PersistentSessionProvider.tsx` — run ownership, messages/streaming context.
- `src/stores/loop-store.ts`, `src/stores/theme-store.ts`, `src/stores/interaction-store.ts` — global stores driving UI + loop config.
- `src/libs/lock.ts` — cross-instance file locking (`withLock`).
- `src/hooks/useRunMetrics.ts`, `src/components/session/Prompt.tsx`, `src/harness/agent/factory/agent/registry.ts` (agents ask/coder/plan-code/persistent).
- `README.md` — the only documentation; keep it in sync with behavior changes.

## Runtime/Tooling Preferences

- **Runtime**: Bun ≥ 1.x required — no Node. ESM (`"type": "module"`), `"module": "src/cli.ts"`.
- **Package manager**: Bun (`bun.lock`). Never commit `package-lock.json`/`yarn.lock`.
- **Stack**: AI SDK 7.x (`ai`, `@ai-sdk/*`, zod 4), React 19, OpenTUI 0.5.9, `@xstate/store-react` 2, xterm 6 + addon-fit, `@vscode/ripgrep`, `diff`, puppeteer (headless Chrome for web tools), turndown (HTML→Markdown), `@whiskeysockets/baileys` (WhatsApp), `@opencode-ai/models` (provider model catalogs), `opentui-spinner`, `commander` (CLI parsing), `pino`. TypeScript ^5 is a peer dep.
- **User config**: `~/.picobu/options.json` (auto-created as `{}`) — four blocks: `providers` (type `anthropic | openai-compatible | openai-responses | openai`, models with context/output/reasoning/efforts/billing), `harness` (`defaultModel` `"<providerId>/<modelId>"` + `modelRoles`), `theme` (default `{key: "tacos", variant: "dark"}`), `web` (default `{host: "0.0.0.0", port: 8080}`), plus `whatsapp` (`enabled`, `allowedNumbers`). OAuth credentials live separately in `~/.picobu/auth.json`; sessions in `~/.picobu/sessions/`; prompt history in `~/.picobu/prompt-history.json`; cron jobs in `~/.picobu/crons.json`.
- **Model roles**: `tiny` (thinking none), `flash` (ask + coder; model's `defaultEffort`), `heavy` (plan-code; `heavyThinkingLevel` → high). Coding runs cap at 100 steps; the persistent agent runs fresh tool-less sessions capped at 10 steps per prompt.
- `.commandcode/` is gitignored local editor-sandbox config (shell allow-list for the dev server), not repo runtime code.

## Testing & QA

- **Framework**: `bun:test` (`describe`/`test`/`expect` from `"bun:test"`; `@types/bun` in devDeps). Run with `bun test` or `bun test <path>` — there is **no** `test` script in package.json.
- **Conventions**: colocate `foo.test.ts` next to `foo.ts`; async callbacks; exact-equality assertions (`toBe`) against real filesystem state; temp-dir isolation (`mkdtemp` in `tmpdir()`, cleaned in `finally { rm(dir, {recursive: true, force: true}) }`); no mocks/fixtures/snapshots.
- **Coverage**: 202 tests across 30 files. Tested surface: the `write` tool stream contract; flow tools (`todo` persistence, `ask` args/handler, `plan-exit` picker switch, `plan-write` stub); `interaction-store`; `compactor` (threshold + serialization); `sessions` (save/load, dedupe, sanitize, tombstones, unanswered-prompt drop, `listSessions`); `prompt-history`; themes (all 44 palettes resolve and pass contrast checks in both variants); auth (PKCE, device-code polling, JWT claims, credential store, provider registration/repointing); cron schedules; WhatsApp (contacts, inbound bus, phone normalization); external tools (Chrome identity, html-to-markdown, websearch parsing, webfetch e2e); components (CommandPicker windowing/clipping, model-roles resolution, motivational phrases, plan-review prompts). Still untested: read/edit/glob/grep/bash handlers, markdown parser, lock layer, most hooks and UI components.
- **QA gate**: `bun run tsc` is the only project-wide check. When changing behavior, follow the write-test example: deterministic, isolated, end-to-end against the observable contract.