---
name: review
description: Spawn the Reviewer subagent on the current changes, or a given commit/branch/PR
---
Review code changes with the Reviewer subagent.

Call the `spawn` tool with subagent name `reviewer`.

The spawn prompt must be self-contained (subagents cannot ask questions):
- Pass the user's review target verbatim: {USER_PROMPT}
- When the target above is empty, instruct the reviewer to review all uncommitted changes: run `git diff` for unstaged changes, `git diff --cached` for staged changes, and `git status --short` for untracked files.
- Include any context the reviewer cannot infer on its own (what the change is meant to do, which files matter most).

When the reviewer reports back, relay its findings to the user as-is: lead with real bugs and their severity, then the rest. Do not silently fix issues or soften findings — `/review` reports, it does not fix.
