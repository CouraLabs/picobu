# Agents

An agent is a system prompt plus a tool allow-list, running on the `flash` model role by default. Picobu ships five built-in agents, and projects can define custom subagents that extend or override the built-ins.

## Built-in agents

| Agent | Role | Tools |
| --- | --- | --- |
| `ask` | Fast Q&A; cannot edit files or execute anything | `read`, `grep`, `glob`, `skill`, `rule`, `websearch`, `webfetch`, `ask`, `spawn` |
| `coder` | Default coding loop: edit, run, verify | `read`, `write`, `edit`, `glob`, `grep`, `shell`, `task_output`, `task_stop`, `ask`, `todo`, `skill`, `rule`, `spawn`, `websearch`, `webfetch` |
| `grill` (display name **Grill**) | Interviews the user to reach a shared understanding (a design tree), then hands off to Plan or Coder | `read`, `grep`, `glob`, `skill`, `rule`, `ask`, `grill-exit`, `spawn` |
| `plan-code` (display name **Plan**) | Deep planning + implementation handoff; no code edits until the plan is approved | `read`, `grep`, `glob`, `skill`, `rule`, `ask`, `plan-write`, `plan-exit`, `spawn` |
| `persistent` | Fresh, stateless runs per prompt; ships with the WhatsApp integration | `wwp-msg`, `wwp-today`, `rule` |

Cycle agents with `SHIFT+TAB` in the TUI.

## Custom agents

Custom agents are markdown files in `.agents/agents/*.md` with frontmatter:

```markdown
---
name: my-agent
description: What this agent is for
category: coding
tools: read, grep, glob
model: anthropic/claude-sonnet-4-5
---

Agent prompt body here.
```

- `tools` accepts a comma list, `*` for all tools, or `none` for no tools. An empty value means all tools.
- `model` optionally pins a model key (`"<providerId>/<modelId>"`).
- A custom agent whose `name` matches a built-in subagent (`executor`, `explorer`, `reviewer`, `debugger`) overrides it for this project.

Picobu ships four built-in subagents — `executor` (single-task implementer), `explorer` (read-only codebase search), `reviewer` (change review), and `debugger` (root-cause a failure before fixing) — all available to the `spawn` tool. Read-only agents can only spawn read-only subagents (`explorer`, `reviewer`), so write-capable subagents (`executor`, `debugger`) are hidden from and rejected by them.

Every subagent prompt gets a rules block appended automatically: no user interaction (never ask, wait, or submit plans — resolve ambiguity yourself and state assumptions), context isolation (work only from the given prompt), a self-contained summary as the last text message, and a status-line report contract (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` plus evidence). Interactive tools are stripped from the tool list, and spawn depth is capped at 3.

## Skills

Skills are loadable knowledge packs in `.agents/skills/<name>/SKILL.md` with `name` + `description` frontmatter; the body and related files are returned to the agent on demand via the `skill` tool, and `/skill:<name>` runs them as commands. Shipped skills: `ai-sdk`, `baileys-wp`, `opentui`, `release`, `typescript-best-practices`, `solid-js-best-practices`.

## Rules

Rules are flat markdown files with `name` + `description` frontmatter (a missing description skips the file) that are discovered and applied on demand via the `rule` tool. No rules ship with Picobu — drop your own into `.agents/rules/` (or `~/.picobu/rules`, `~/.agents/rules`).

## Workflows, prompts, commands

Workflows (multi-step prompted commands), prompts, and slash commands resolve in precedence order: project (`.agents/workflows|prompts|commands`) → `~/.picobu` → `~/.agents`. Skills resolve from `.agents/skills`, `~/.picobu/skills`, and `~/.agents/skills` in that order. `/reload` re-reads all of them from disk.

Project instructions are automatic: at session start the system prompt embeds `AGENTS.md` (or `CLAUDE.md`) from the working directory (truncated at 2000 chars), plus discovered skills, rules, subagents, and MCP tool schemas.

## See also

- [tools.md](tools.md) — the tools referenced above
- [../configuration/providers.md](../configuration/providers.md) — model roles (`flash`, `tiny`)
- [sessions.md](sessions.md) — spawn capacity and depth caps
