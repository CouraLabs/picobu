## Commands
- Verify order: `bun run lint` -> `bun run tsc` -> `bun test tests/<dir>/<file>.test.ts`.
- Smoke: `bun src/dev/smoke.ts` needs a real model in `~/.picobu/options.json`. Unit tests don't: fake model keys, tmp dirs.

## Imports & style
- Path aliases, never relative imports across `src/` folders: `@agent/*`, `@auth/*`, `@config/*`, `@integrations/*`, `@shared/*`, `@states/*`, `@tui/*`, `@wrappers/*`.
- Keep `.ts`/`.tsx` extensions in imports (NodeNext + `allowImportingTsExtensions`). `verbatimModuleSyntax` is on: type-only imports need `import type` / `import { type X }`.
- Tests import source via relative paths (`../../src/...`), not aliases — aliases are a `src/`-only convention.
- JSX is OpenTUI + Solid, not DOM (`jsxImportSource: @opentui/solid`): elements are `<box>`, `<text>`, `<input>`, ... with props like `marginTop`/`textColor` — never HTML tags or `class=`.
- Biome covers `src` + `tests` only: single quotes, no semicolons, 2-space indent, 200-col width. No code comments.

## Layout
- `src/cli.ts` is the entry and bootstrap; `src/config/options.ts` owns `~/.picobu/options.json`.
- `src/agent/`: `loop/`, `sessions/`, `model/`, `agents/` + `subagent/`, `prompts/`, `tools/filesystem|flow|web/`.
- `src/integrations/` holds WhatsApp (Baileys) + MCP. `src/tui/`, `src/states/`, `src/wrappers/` are host-frontend kit.
- `tests/` mirrors `src/`. No CI; run the checks locally.
- Rules load from `.agents/rules/*.md` (frontmatter `name` + `description` required — missing description = skipped); skills from `.agents/skills/<name>/SKILL.md`.
- Embedded into every session's system prompt at startup (`AGENTS.md`/`CLAUDE.md` from cwd), truncated at 2000 chars — put critical facts above the cut.

## Versioning
- `package.json` `version` is the source of truth: `1.<features>.<build>`. Read via `getVersion()` in `src/shared/version.ts`; never hardcode. Bump: `bun run version:bump` (build +1) or `version:feature` (features +1, build resets).
