---
name: bump-version
description: Bump the package version following the 1.<features>.<build> scheme
---

Bump `package.json` `version`, the source of truth read via `getVersion()` in `src/shared/version.ts`. Never hardcode the version elsewhere.

User-provided focus or constraints (honor these):

{USER_PROMPT}

## How to decide the kind

Read `scripts/bump-version.ts` and `src/shared/version.ts` first. The scheme is `1.<features>.<build>` (major stays `1`):

- `build` (default): patch +1, for fixes, docs, chores — anything that is not a user-facing feature. Repository chores such as new workflows, rules, skills, docs, and license text are always `build`.
- `feature` (`--feature`): minor +1 and build resets to 0, for user-facing features. Only apply on explicit request or when the change set clearly ships user-facing behavior.

If the change set mixes both, it is a `feature` bump. If the request sets an explicit number (e.g. an initial feature count), skip the script and edit `package.json` directly — the script only steps +1.

Only ask the user when the repo cannot answer it: whether an ambiguous change counts as a feature, or what basis to use for an explicit count. Use the **ask** tool for one short batch at most.

## Steps

1. Run `bun ./scripts/bump-version.ts` (or with `--feature`), or edit `package.json` for an explicit number.
2. Verify with `bun -e "import {getVersion} from './src/shared/version.ts'; console.log(getVersion())"`.
3. Report the `old -> new` transition and which kind was applied and why.
