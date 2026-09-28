---
name: release-picobu
description: Cut a new Picobu release (bump, build, publish, tag, GitHub release) and announce it on Discord
---
Cut a new Picobu release. `scripts/publish.ts` announces the release on Discord by itself.

Use the `release` skill: load it with the `skill` tool before starting.

User-provided focus or constraints (honor these):

{USER_PROMPT}

## Steps

1. Load the `release` skill and follow it exactly.
2. Confirm the working tree is clean (`git status --short`). If it is dirty, stop and report before releasing.
3. Run `bun run release`. This runs typecheck + tests, bumps the build number, builds, publishes to npm, tags `vX.Y.Z`, pushes the tag, creates the GitHub release, and — when `PICOBU_DISCORD_WEBHOOK_URL` is set — announces the release on Discord.
4. Capture the released version: read `version` from `package.json` and the created tag (`git describe --tags --abbrev=0`). Confirm the GitHub release exists (`gh release view vX.Y.Z`).

## Discord announcement

`scripts/publish.ts` owns the Discord announcement — do not POST manually. After the GitHub release step it posts an embed with categorized release notes (Features / Fixes / Other, derived from `git log <prevTag>..HEAD --no-merges`) and the install command `bun add -g @couralabs/picobu --force --trust`, using the webhook in the `PICOBU_DISCORD_WEBHOOK_URL` environment variable. When that variable is unset the announcement is skipped and the release still succeeds. Never echo the webhook URL or token.

## Reporting

Report the released version, the npm package URL, the GitHub release URL, and whether the Discord announcement was delivered (read it from the `bun run release` output: `announced Picobu vX.Y.Z on Discord` vs `PICOBU_DISCORD_WEBHOOK_URL not set — Discord announcement skipped`). Never echo the webhook URL or token.
