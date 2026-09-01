# Repository Guidelines

## Project Overview

PICOBU is an autonomous coding agent that lives in your terminal: type a prompt and it reads, plans, and edits your project step by step, with live tool-call rendering and per-run token/cost metrics. One React app serves two frontends — a native TUI (OpenTUI over Bun) and a browser client (xterm.js over a Bun HTTP+WebSocket server). Built on the Vercel AI SDK, XState Store, and Zod; scaffolded with `bun create tui`.

## Architecture & Data Flow

Two entry points feed one React app via `startPicobu(renderer, opts)` in `src/app.tsx`, which creates per-session `SessionBindings` and renders `<SessionBindingsProvider><App/></SessionBindingsProvider>`:

- `src/index.tsx` — OpenTUI CLI renderer (run with `bun dev`).
- `src/server.ts` — Bun HTTP+WS server (`bun run web`); serves `web/index.html` + xterm.js assets, one `CliRenderer` per WebSocket tab (binary frames = ANSI renderer output, JSON `{type:'resize',cols,rows}` frames in, raw keyboard bytes in).

Prompt flow: `Prompt` textarea → `usePromptClipboard.resolveAndClear` (paste → embed tokens) → `CodingSessionContext.onPrompt` → `/`-commands resolved via `resolveCommandPrompt` (system commands mutate `loopStore`; skills/workflows are rewritten into prompts) or direct submit → `sendMessage({text, files})` on `useChat` with the `DirectChatTransport` from `createLoop`.

`createLoop` (`src/harness/agent/factory/loop/create-loop.ts`) builds a `ToolLoopAgent` whose `prepareCall` re-resolves the model, active tools, cached sectioned system prompt, and thinking effort from the live `loopStore` snapshot **every step** — so agent/model/thinking switches mid-conversation need no new loop. Tool parts stream back into `useChat` messages and are converted by `toolPartToModel` (`tool-model-parser.ts`) into a discriminated `ToolCallModel` rendered by per-tool variant components in `src/components/coding/tools/` (exhaustive switch + `assertNever`).

State split: global singleton XState stores (`loopStore`, `themeStore`, `settingsStore`, `footerToastStore`, `clipboardStore`) hold UI + loop config; the run itself (messages/status/metrics) lives in the per-session React context, so in-flight runs survive page switches. Settings writes go through `saveSettings` → `updateSettings` with `withLock` on `~/.picobu/options.json`; tool file mutations are serialized with `withLock`; run completion fires desktop notifications via `src/libs/notify.ts`.

## Key Directories

- `src/libs/` — config (`options.ts`: load/persist/migrate `~/.picobu/options.json`, `resolveModelRole`), `lock.ts` (process-bound file locking), `shell.ts` (shell detection), `embeds.ts` (`T#N`/`F#N` prompt tokens), `notify.ts`, `clipboard.ts`, `filetype.ts` (ext→OpenTUI syntax map), `text-stats.ts`.
- `src/stores/` — global XState singleton stores: `loop-store` (agent/model/thinking/pickers), `theme-store`, `settings-store` (+ `saveSettings`), `footer-toast-store`, `clipboard-store`. `coding-store.ts` is legacy/unused.
- `src/harness/` — agent runtime. `agent/factory/` (provider-resolver, agent registry/create-agent, `loop/create-loop`); `agent/tool/` (toolset, tool-model-parser, `filesystem/` read/write/edit/glob/grep/bash, `agentic/` spawn/kill-agent — currently empty); `agent/prompts/` (coder/ask/plan/system TS templates); `agent/markdown/` (frontmatter parser); `agent/subagent/` (executor prompt); `agent/skills/` + `agent/workflow/` + `memory/` + `integration/` — empty dirs; `commands/` (index, discovery, bindings, types, `system/` quit|models|effort).
- `src/integrations/whatsapp-integration.ts` — empty (0-byte) stub.
- `src/providers/` — `session-provider.tsx` (CodingSessionContext: loop + useChat + metrics + notifications), `session-bindings.tsx`.
- `src/hooks/` — `useRunMetrics`, `useLoopKeybinds` (swallows all keys mid-stream), `useGitStatus`, `useClipboard`/`usePromptClipboard`, `useCopyToClipboard` (OSC 52), `useCopyableMessage`, `useSession`, `useRunCompletionNotification`, `useHeartbeatColor`.
- `src/pages/` — `SessionPage` (coding + persistent tabs) and the other routed pages (WhatsApp/Pomodoro/Crons/3D).
- `src/components/` — `Header`/`Tab`/`Footer`/`Theme`; `coding/` (ChatMessages, Prompt, ToolCall + per-tool renderers, pickers, ThinkingMessage); `ui/` (Button, InputField); `symbols/` (icons, logo).
- `src/themes/` — `index.ts` (~1115 lines): 44 JSON palettes in `assets/`, `Theme` type (~90 RGBA fields), contrast-aware `resolveTheme`/`generateSyntax` (selection ink derived from panel luminance), persisted `{key, variant}`.
- `web/` — `index.html`: xterm.js browser host served by `server.ts`.

## Development Commands

```bash
bun install        # install dependencies (Bun is the only package manager; bun.lock)
bun dev            # run the TUI (bun run --watch src/index.tsx)
bun run web        # browser client via xterm.js (bun run src/server.ts)
bun run tsc        # type-check (tsc -noEmit) — the only verification gate
bun test           # run tests (bun:test discovery of *.test.ts; no npm test script)
```

- Resume a run: `picobu --session <session_id>` (banner shown on TUI exit).
- `HOST`/`PORT` env vars override `options.web`.
- No build step, bundler, linter, formatter, or CI config exists — do not introduce one without asking.

## Code Conventions & Common Patterns

- **XState stores** (`@xstate/store-react`): `createStore({ context: {...}, on: { action: (state, e) => ({...state, ...}) } })` with fresh spreads in reducers. Read in components via `useSelector(store, (s) => s.context.x)`; imperative reads via `store.getSnapshot().context`; mutate via `store.trigger.<action>({...})`. Cycling actions (`nextAgent`/`nextThinking`) wrap around with modulo.
- **Hooks**: `useX` naming; thin wrappers over stores/context returning plain objects; `useRef` for mutable timing/identity, `useCallback` for stable handlers.
- **Components**: plain functions (no memo); lowercase intrinsic OpenTUI elements (`box`, `text`, `scrollbox`, `textarea`, `spinner`, `markdown`, `code`) with flexbox layout; colors passed as props from the theme selector; icons from `components/symbols/icons`.
- **Error handling**: throw `new Error(...)` inside tools and resolvers — the AI SDK surfaces them as `errorText` → `ToolStatus` in the UI (see `edit.ts` refusing ambiguous replaces). `try/catch` only around best-effort side effects (notify, clipboard → return null). Exhaustive switches + `assertNever` for closed unions (`ToolCall.tsx`). No Result monads.
- **Async**: `async`/`await` throughout. Tool handlers may return `Promise | AsyncIterable | ReadableStream` (e.g. `writeTool` streams content + `\n<N> lines written` trailer). Wrap file mutations in `withLock(path, fn)` from `src/libs/lock.ts`.
- **DI (no framework)**: module-level `options` singleton (loaded at import in `libs/options.ts`) consumed everywhere; models resolved per call via `resolveModel(modelKey)` using AI SDK factories (`createAnthropic`/`createOpenAICompatible`/`createOpenResponses`) keyed by provider `type`; `"env:VAR_NAME"` apiKey refs resolved at construction; agents statically registered in `factory/agent/registry.ts` (`AGENTS: Record<string, AgentType>`); the loop takes a `getConfig` closure so per-step config stays live.
- **Zod schemas**: every tool exports `XxxToolArgsSchema` / `XxxToolOutputSchema` (`z.object`); `wrapTool` (`tool/toolset.ts`) converts to AI SDK `tool()` and renders `z.toJSONSchema` into the system prompt. Tests pin args with `satisfies z.infer<typeof XxxToolArgsSchema>`.
- **Markdown as config**: agents, skills, workflows, and commands are markdown with flat-YAML frontmatter parsed by `src/harness/agent/markdown/markdown-parser.ts` (key: value only; supports `{PARAM}` substitution). Frontmatter fields in use: `name`, `description`, `tools` (comma list; `*` = all), `model`, `color`. System prompt is sectioned by `#` headings (`prompts/system.ts`).
- **Bun-first APIs**: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.Glob`, `Bun.serve`; ripgrep via `@vscode/ripgrep` `rgPath`; diffs via `diff` package `createTwoFilesPatch`.
- **TypeScript**: strict + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`; `verbatimModuleSyntax` (use `import type`); `module: Preserve` + bundler resolution + `allowImportingTsExtensions` (import with `.ts` extensions); `jsxImportSource: @opentui/react`.

## Important Files

- `src/libs/options.ts` — config types/defaults, `~/.picobu/options.json` load/persist, legacy `defaults.model` → `harness.defaultModel` migration, `resolveModelRole` defaults (tiny: none, flashThinking: medium, heavyThinkingLevel: high).
- `src/server.ts` — web/xterm host, session-stream wiring (one picobu session per tab).
- `src/harness/agent/factory/provider-resolver.ts` — model DI, `env:` key resolution, `resolveModel`/`listModels`/`resolveDefaultModelKey`.
- `src/harness/agent/factory/loop/create-loop.ts` — `ToolLoopAgent` + `DirectChatTransport`, per-step `getConfig`, system-prompt cache, Anthropic cacheControl 1h.
- `src/harness/agent/tool/toolset.ts` + `filesystem/` — tool registration pattern and the six filesystem tools.
- `src/harness/commands/discovery.ts` — slash-command catalog + prompt assembly (see below).
- `src/providers/session-provider.tsx` — run ownership, messages/streaming context.
- `src/stores/loop-store.ts`, `src/stores/theme-store.ts` — the two global stores driving UI + loop config.
- `src/libs/lock.ts` — cross-instance file locking (`withLock`).
- `src/hooks/useRunMetrics.ts`, `src/components/coding/Prompt.tsx`, `src/harness/agent/factory/agent/registry.ts` (agents ask/coder/plan-code).
- `README.md` — the only documentation; keep it in sync with behavior changes.

## Runtime/Tooling Preferences

- **Runtime**: Bun ≥ 1.x required — no Node. ESM (`"type": "module"`), `"module": "src/index.tsx"`.
- **Package manager**: Bun (`bun.lock`). Never commit `package-lock.json`/`yarn.lock`.
- **Stack**: AI SDK 4.x (`ai`, `@ai-sdk/*`, `zod` 4), React 19, OpenTUI 0.5.6, `@xstate/store-react` 2, xterm 6 + addon-fit, `@vscode/ripgrep`, `diff`, `@whiskeysockets/baileys` (WhatsApp stub), `opentui-spinner`. TypeScript ^5 is a peer dep.
- **User config**: `~/.picobu/options.json` (auto-created as `{}`) — four blocks: `providers` (type `anthropic | openai-compatible | openai-responses`, models with context/output/reasoning/efforts/billing), `harness` (`defaultModel` `"<providerId>/<modelId>"` + `modelRoles`), `theme` (default `{key: "tacos", variant: "dark"}`), `web` (default `{host: "0.0.0.0", port: 8080}`).
- **Model roles**: `tiny` (thinking none), `flash` (ask + coder; model's `defaultEffort`), `heavy` (plan-code; `heavyThinkingLevel` → high).
- `.commandcode/` is gitignored local editor-sandbox config (shell allow-list for the dev server), not repo runtime code.

## Testing & QA

- **Framework**: `bun:test` (`describe`/`test`/`expect` from `"bun:test"`; `@types/bun` in devDeps). Run with `bun test` or `bun test <path>` — there is **no** `test` script in package.json.
- **Conventions**: colocate `foo.test.ts` next to `foo.ts`; async callbacks; exact-equality assertions (`toBe`) against real filesystem state; temp-dir isolation (`mkdtemp` in `tmpdir()`, cleaned in `finally { rm(dir, {recursive: true, force: true}) }`); no mocks/fixtures/snapshots.
- **Coverage**: currently a single test — `src/harness/agent/tool/filesystem/write/write.test.ts` (writeTool stream contract: content verbatim + `\n<N> lines written` trailer, parent dirs created). Untested surface: edit/read/glob/bash tools, markdown parser, session/lock layer, stores, hooks, components. No CI and no coverage tooling.
- **QA gate**: `bun run tsc` is the only project-wide check. When changing behavior, follow the write-test example: deterministic, isolated, end-to-end against the observable contract.
