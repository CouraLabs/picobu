---
name: release-picobu
description: Cut a new Picobu release (bump, build, publish, tag, GitHub release) and announce it on Discord
---
Cut a new Picobu release, then announce it on Discord.

Use the `release` skill: load it with the `skill` tool before starting.

User-provided focus or constraints (honor these):

{USER_PROMPT}

## Steps

1. Load the `release` skill and follow it exactly.
2. Confirm the working tree is clean (`git status --short`). If it is dirty, stop and report before releasing.
3. Run `bun run release`. This runs typecheck + tests, bumps the build number, builds, publishes to npm, tags `vX.Y.Z`, pushes the tag, and creates the GitHub release.
4. Capture the released version: read `version` from `package.json` and the created tag (`git describe --tags --abbrev=0`). Confirm the GitHub release exists (`gh release view vX.Y.Z`).
5. Announce the release on Discord using the webhook request below.

## Discord announcement

POST to the webhook with the `bash` tool (do not print the URL or token back to the user):

```sh
curl -fsS -X POST "https://discord.com/api/webhooks/1553457168987070554/Qmp53MBKwotYLtwLBN8Gw_COx92G1QJB8HlZGWlhPbR6U6DJ1Pyq3qmwA7hry9NzUonw" \
  -H "Content-Type: application/json" \
  -d '{"content":"🚀 **Picobu vX.Y.Z** is out!","embeds":[{"title":"Picobu vX.Y.Z","url":"https://github.com/CouraLabs/picobu/releases/tag/vX.Y.Z","color":5814783,"fields":[{"name":"npm","value":"https://www.npmjs.com/package/picobu/v/X.Y.Z","inline":false},{"name":"Release notes","value":"https://github.com/CouraLabs/picobu/releases/tag/vX.Y.Z","inline":false}]}]}'
```

Substitute the real `X.Y.Z` version everywhere before sending. If the POST fails, report the HTTP status and body, then stop — the release itself already succeeded.

## Reporting

Report the released version, the npm package URL, the GitHub release URL, and whether the Discord announcement was delivered. Never echo the webhook URL or token.
