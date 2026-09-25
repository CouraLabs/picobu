# Host frontends

Picobu's core is headless: the agent loop, sessions, and tools live in `src/agent/`, and every interface is a frontend that renders and drives runs. The reference frontend is the OpenTUI terminal UI; a library kit covers everything else you might attach.

## Reference TUI

`src/tui/` over OpenTUI + Solid (mouse + Kitty keyboard, 30–60fps):

- Session page with streamed text/reasoning/tool parts — `ask` renders its form inline, plans render for review
- Session header and status bar (both layout-configurable — see [configuration/session-layout.md](configuration/session-layout.md))
- Message actions, diff viewer, dialogs/dropdowns, hover tooltips (`Tooltip` wrapper + `TooltipLayer` with dropdown-style flip/clamp positioning)
- Splash screen and 35 bundled themes (`picobu` dark by default; `resolveTheme`/`generateSyntax`), icon set
- Solid state primitives for dialogs, dropdowns, tooltips, theme, and toasts in `src/states/`
- Clipboard goes through an OpenTUI service adapter

Mouse interactions are listed in [keybindings.md](keybindings.md).

## Library kit

- `createHeadlessChatState()` implements the AI SDK `ChatState` contract over the loop — reuse `useChat` against any session
- `src/wrappers/` bundles tree-sitter parser WASMs + highlight queries for 39 languages (`createTreeSitterClient()`, data under `~/.picobu/tree-sitter`)
- Prompt history and session-title helpers round out host needs

No UI logic lives in the agent loop.

## Project layout

- `src/cli.ts` — entry + bootstrap
- `src/agent/` — `loop/`, `sessions/`, `model/`, `agents/` + `subagent/`, `prompts/`, `tools/filesystem|flow|web/`, `commands/`, `rules/`, `workflows/`
- `src/config/options.ts` — `~/.picobu/options.json`
- `src/auth/` — OAuth
- `src/integrations/` — MCP
- `src/tui/`, `src/states/`, `src/wrappers/` — host-frontend kit
- `src/shared/` — cross-cutting utilities

Every `src/` folder is importable as `@<folder>` via `tsconfig.json` paths (e.g. `import { options } from "@config/options.ts"`); tests import via relative paths and mirror `src/` under `tests/`.

Tech stack: Vercel AI SDK (`ai`, `@ai-sdk/*`) · OpenTUI + Solid (`@opentui/*`, `solid-js`) · Zod · Bun · Biome (single quotes, no semicolons, 2-space indent).

## See also

- [usage/sessions.md](usage/sessions.md) — the `Session` facade your frontend drives
- [configuration/options.md](configuration/options.md) — TUI options
