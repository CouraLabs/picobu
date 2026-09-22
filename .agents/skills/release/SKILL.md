---
name: release
description: 'Cut a new Picobu release: bump version, build, publish to npm, tag, and create the GitHub release with auto-generated notes via gh (REST API fallback). Use when: (1) publishing a new version, (2) creating or backfilling a GitHub release/tag, (3) generating release notes, (4) the GitHub releases page is behind the npm version, (5) working on scripts/publish.ts, scripts/bump-version.ts, or src/shared/version.ts. Triggers on: "release", "publish", "tag", "github release", "release notes", "bump version".'
---

# Release — versioning, npm publish, and GitHub releases

## Version model
- `package.json` `version` is the source of truth: `1.<features>.<build>` (major stays 1).
- Read at runtime via `getVersion()` in `src/shared/version.ts` — never hardcode.
- Bump: `bun run version:feature` (features +1, build → 0) or `bun run version:bump` (build +1).

## Automated release
`bun run release` runs `scripts/publish.ts`:
1. `tsc` then unit tests (stop on failure)
2. bump the build number in `package.json`
3. `bun scripts/build.ts` (bundle + smoke test)
4. `bun publish --access public --cpu=* --os=*`
5. `git tag vX.Y.Z` + `git push origin vX.Y.Z` (skipped if the tag exists)
6. create the GitHub release for the tag (see below)

## Release mechanism
- Prefers the GitHub CLI: `gh release create vX.Y.Z --generate-notes --verify-tag`.
- If `gh` is missing or fails, falls back to the REST API: `POST https://api.github.com/repos/CouraLabs/picobu/releases` with `{"tag_name":"vX.Y.Z","name":"vX.Y.Z","generate_release_notes":true}` using `GH_TOKEN` (preferred) or `GITHUB_TOKEN`.
- The script derives the repo slug from `package.json` → `repository.url`.

## Prerequisites
- `gh` installed and `gh auth status` green, **or** `GH_TOKEN`/`GITHUB_TOKEN` exported with `repo` scope.
- The tag must be pushed to `origin` before the release is created (the script does this).

## Release notes
GitHub auto-generates notes from commits/PRs since the previous release (`--generate-notes`). No local changelog is written.

## Verify
```sh
gh release list
gh release view vX.Y.Z
```

## Manual fallback / backfill
For a tag that was published before releases were automated (e.g. `v1.30.10`, `v1.31.1`):
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
