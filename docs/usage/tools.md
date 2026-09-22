# Tools

Every tool carries a JSON Schema that is rendered into the system prompt. Agents with empty `tools` frontmatter get everything below; explicit-tool agents (like `coder`) opt in by name — including MCP tools, which only all-tools agents pick up automatically. MCP servers add more tools at runtime — see [mcp.md](mcp.md).

## Filesystem

| Tool | Description |
| --- | --- |
| `read` | Read a file (`skip`/`limit` slice lines) or list a directory; rejects binaries, images/PDFs return metadata only, long output is capped |
| `write` | Write contents to a path, creating parent directories; records an undo checkpoint |
| `edit` | Replace `oldString` with `newString` (exact or whitespace-tolerant match); fails on missing matches, refuses ambiguous single replaces unless `replaceAll` is true, returns a diff |
| `glob` | Find files by glob pattern; respects `.gitignore` |
| `grep` | Search files with ripgrep regex; returns matching lines as `path:line: content`; `include` filters by file glob |
| `shell` | Run a shell command; streams output live, kills on timeout. Large output is tailed near 50KB/2000 lines with the full log spilled to a file. `run_in_background: true` returns a `taskId` immediately; collect with `task_output`, stop with `task_stop` |
| `repo-map` | Structural map of the repository: top files ranked by relevance with key symbols (functions, classes, types) extracted via tree-sitter, capped to a token budget; `focus` boosts paths you care about |

`glob`/`grep` always include agent config folders (`.agents`, `~/.agents`, `~/.picobu`) even when gitignored.

## Flow

| Tool | Description |
| --- | --- |
| `todo` | Session todo list: a full `items` array replaces the list in place, `[]` clears it; persisted per session |
| `skill` | Load a discovered skill by name (SKILL.md body + related file paths) |
| `rule` | Load a discovered rule by name and apply it |
| `ask` | **Interrupting** — ask the user up to 5 structured single/multiple-choice questions; the run pauses until answers arrive |
| `plan-write` | **Interrupting** — submit the finished plan for review; the run pauses for approval/rejection |
| `plan-exit` | Hand off to the coder agent to implement the approved plan (only after explicit approval) |
| `spawn` | **Blocking** — run a subagent by name as an isolated sub session; parallel spawns settle together |

## External

| Tool | Description |
| --- | --- |
| `websearch` | Web search via DuckDuckGo; `deepness` 1–5 sets pages scanned, each result fetched as Markdown |
| `webfetch` | Fetch a URL as Markdown; fast HTTP first, headless-Chrome fallback for JS-rendered pages, timeout up to 120s |

Web tools use headless Chrome with a real-Chrome identity (bot-protection resistant); HTML converts to Markdown via turndown. They require the Puppeteer Chrome downloaded during `bun install`.

## Integrations and MCP

| Tool | Description |
| --- | --- |
| `wwp-msg` | Send a WhatsApp text message to a phone number (WhatsApp integration) |
| `wwp-today` | Add a task to the user's `today` todo list (WhatsApp integration) |
| `mcp_<server>_<tool>` | Auto-discovered MCP tools, namespaced and capped at 64 chars — see [mcp.md](mcp.md) |

## See also

- [../agents.md](agents.md) — which agents get which tools
- [mcp.md](mcp.md) — extending the toolset with MCP servers
- [sessions.md](sessions.md) — sandbox rules for `shell` and file tools
