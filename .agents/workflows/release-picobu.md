---
name: release-picobu
description: Cut a new Picobu release (bump, build, publish, tag, GitHub release) and announce it on Discord
---
Cut a new Picobu release. `scripts/publish.ts` announces the release on Discord by itself.

User-provided focus or constraints (honor these):

{USER_PROMPT}

## Version model

- `package.json` `version` is the source of truth: `0.<features>.<build>` (major stays 0, changed manually).
- Read at runtime via `getVersion()` in `src/shared/version.ts` — never hardcode.
- Bump: `bun run version:feature` (features +1, build → 0) or `bun run version:bump` (build +1).

## Steps

1. Confirm the working tree is clean (`git status --short`). If it is dirty, stop and report before releasing.
2. Run `bun run release`. This runs `scripts/publish.ts`, which:
   1. runs `tsc` then unit tests (stops on failure);
   2. bumps the build number in `package.json`;
   3. runs `bun scripts/build.ts` (bundle + smoke test);
   4. runs `bun publish --access public --cpu=* --os=*`;
   5. creates `git tag vX.Y.Z` and pushes it to `origin` (skipped if the tag already exists);
   6. creates the GitHub release for the tag (see below);
   7. announces the release on Discord (best-effort; see below).
3. Capture the released version: read `version` from `package.json` and the created tag (`git describe --tags --abbrev=0`). Confirm the GitHub release exists (`gh release view vX.Y.Z`).
4. Commit the version bump and push it: the release leaves `package.json` modified with the new version (`0.<features>.<build>`) and does not commit it. Stage and commit `package.json` (message `chore: release vX.Y.Z`), then `git push origin HEAD` so the bump lands on the branch. Do this after the release finishes — the tag is already pushed by the script.

## Do not poll the registry

Never check the npm registry for the new version (`npm view @couralabs/picobu`, `bun pm view`, fetching the registry URL, etc.) — propagation can take a few minutes and would falsely look like a failure. A successful `bun publish` (no error) means the version **will** be on the registry within a few minutes; that is the success signal. Do not retry the publish because the registry has not caught up yet.

## Prerequisites

- `gh` installed and `gh auth status` green, **or** `GH_TOKEN`/`GITHUB_TOKEN` exported with `repo` scope.
- The tag must be pushed to `origin` before the release is created (the script does this).

## Release mechanism

- Prefers the GitHub CLI: `gh release create vX.Y.Z --generate-notes --verify-tag`.
- If `gh` is missing or fails, falls back to the REST API: `POST https://api.github.com/repos/CouraLabs/picobu/releases` with `{"tag_name":"vX.Y.Z","name":"vX.Y.Z","generate_release_notes":true}` using `GH_TOKEN` (preferred) or `GITHUB_TOKEN`.
- The script derives the repo slug from `package.json` → `repository.url`.

## Release notes

GitHub auto-generates notes from commits/PRs since the previous release (`--generate-notes`). No local changelog is written.

## Discord announcement

`scripts/publish.ts` owns the Discord announcement — do not POST manually. After the GitHub release step it posts a Discord embed (best-effort — a failed POST is logged and never fails the release):

- The webhook URL is read from the `PICOBU_DISCORD_WEBHOOK_URL` environment variable. If it is unset/empty the announcement is skipped and the script logs `PICOBU_DISCORD_WEBHOOK_URL not set — Discord announcement skipped`.
- Release notes are categorized from `git log <prevTag>..<tag> --no-merges --pretty=%s` (previous tag via `git describe --tags --abbrev=0 <tag>^`): `feat:`/`feature:` → **Features**, `fix:` → **Fixes**, the rest → **Other**. Empty buckets render as `—`; buckets are capped and show `…and N more` when truncated.
- The embed also carries the install command `bun add -g @couralabs/picobu --force --trust` and the GitHub release link.
- On success the script logs `announced Picobu vX.Y.Z on Discord`.
- Never echo the webhook URL or token.

## Verify

```sh
gh release list
gh release view vX.Y.Z
```

## Manual fallback / backfill

For an existing tag whose release is missing:

```sh
gh release create vX.Y.Z --generate-notes --verify-tag
```

or via the API:

```sh
curl -fsS -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/CouraLabs/picobu/releases \
  -d '{"tag_name":"vX.Y.Z","name":"vX.Y.Z","generate_release_notes":true}'
```

## Troubleshooting

- `release vX.Y.Z already exists, skipping` — the script found the release and did nothing; not an error.
- `tag not found` / `--verify-tag` fails — push the tag first (`git push origin vX.Y.Z`).
- `gh` unauthenticated — re-run `gh auth login`, or set `GH_TOKEN`.
- `cannot create GitHub release ... neither GH_TOKEN nor GITHUB_TOKEN is set` — export a token or install/authenticate `gh`.

## Reporting

Report the released version, the npm package URL (`https://www.npmjs.com/package/@couralabs/picobu/v/X.Y.Z` — construct it, do not fetch it), the GitHub release URL, and whether the Discord announcement was delivered (read it from the `bun run release` output: `announced Picobu vX.Y.Z on Discord` vs `PICOBU_DISCORD_WEBHOOK_URL not set — Discord announcement skipped`). If asked whether the version is live on npm, answer from the publish result, not by polling the registry. Never echo the webhook URL or token.
