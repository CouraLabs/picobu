Do not add code comments. the code should be self explanatory.

## Commands
- `bun install`, `bun dev` (CLI watch), `bun dev:tui` (reference TUI).
- Verify order: `bun run lint` -> `bun run tsc` -> focused `bun test tests/<dir>/<file>.test.ts`. Full suite: `bun test tests`.
- `bun run lint:fix`, `bun run format`, `bun ./scripts/update-tree-sitter-assets.ts` for parser assets.

## Imports & style
- Use path aliases, never relative imports across `src/` folders: `@agent/*`, `@auth/*`, `@config/*`, `@integrations/*`, `@shared/*`, `@states/*`, `@tui/*`, `@wrappers/*`.
- Keep the `.ts`/`.tsx` extension in imports (required by `NodeNext` + `allowImportingTsExtensions`).
- Biome covers `src` + `tests` only: single quotes, no semicolons, 2-space indent, 200-col width.

## Layout
- `src/cli.ts` is the entry (`picobu`, `sessions` subcommands) + bootstrap.
- `src/agent/`: `loop/` (step engine), `sessions/` (facade, manager, checkpoints), `model/` (provider registry), `agents/` + `subagent/`, `tools/filesystem|flow|web/`.
- `src/config/options.ts` owns `~/.picobu/options.json`. `src/integrations/` holds WhatsApp (Baileys) + MCP. `src/tui/`, `src/states/`, `src/wrappers/` are host-frontend kit.
- `tests/` mirrors `src/` (`tests/<area>/*.test.ts`). No CI in-repo; run the three checks locally.

## Versioning
- `package.json` `version` is the source of truth: `1.<features>.<build>` (major locked at `1`, middle counts features, patch counts builds).
- Read it at runtime via `getVersion()` in `src/shared/version.ts`; never hardcode a version string.
- Bump with `bun run version:bump` (build +1) or `bun run version:feature` (features +1, build resets to `0`). Logic lives in `bumpVersion()`; `scripts/bump-version.ts` is a thin wrapper.
- `picobu --version` comes from `program.version(getVersion())` in `src/cli.ts`.

## Console title
- Format via `formatConsoleTitle()` in `src/shared/version.ts`: `Picobu v<version> - <session-title>`, version only when untitled.
- Apply via `setConsoleTitle()` / `resetConsoleTitle()` in `src/shared/console-title.ts` (sets `process.title` + OSC escape).
- `runTui()` sets the version-only title on start and resets on destroy; `SessionPage` syncs it reactively from the session `title` signal.
