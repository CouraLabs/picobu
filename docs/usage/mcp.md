# MCP (Model Context Protocol)

Picobu connects to [MCP](https://modelcontextprotocol.io/) servers via `@ai-sdk/mcp` and merges their tools into every agent loop. Configure servers globally in `~/.picobu/options.json` under `mcp.servers`, and/or per project. Project config is read from `.mcp.json` and `mcp.json` at the project root and in each first-level subfolder (Claude-style `mcpServers` map; `servers` is also accepted). On an id collision the winner, highest priority first, is: root `.mcp.json`, root `mcp.json`, any subfolder `.mcp.json`, any subfolder `mcp.json` — and project config always overrides global.

```json
{
  "mcp": {
    "servers": {
      "linear": {
        "type": "http",
        "url": "https://mcp.linear.app/mcp",
        "auth": true,
        "instructions": "Use for issue tracking; always pass teamId"
      },
      "fs": { "type": "stdio", "command": "npx", "args": ["-y", "fs-mcp"] }
    }
  }
}
```

## Server fields

| Field | Meaning |
| --- | --- |
| `type` | Transport: `http` (recommended), `sse`, or `stdio` (local only). Inferred from `url`/`command` when omitted. |
| `url` | Server URL (required for `http`/`sse`) |
| `command`, `args`, `env` | Local process launch (required for `stdio`) |
| `headers` | Extra HTTP headers; accepts `"env:VAR"` refs |
| `auth` | `true` enables MCP OAuth for this server |
| `instructions` | Guidance rendered into the system prompt alongside the server's tools |
| `maxRetries` | Connection retry cap (floor 0) |

Malformed entries fail fast with a named error, e.g. `MCP server "fs" (stdio) requires "command"`. A malformed project file is skipped with a warning and the remaining files still load; `"env:VAR"` references to unset variables throw at connect time.

## Auth

`auth: true` servers use MCP OAuth:

```sh
picobu mcp login <serverId>    # PKCE flow, localhost:19888 callback
picobu mcp logout <serverId>   # drop stored tokens
```

Tokens live in `~/.picobu/mcp-auth.json` and refresh at connect.

## Discovery

- Tools are namespaced `mcp_<serverId>_<toolName>` (capped at 64 chars).
- Every agent gets all MCP tools active automatically; only agents declaring `tools: none` opt out.
- Each server's tools (plus config `instructions` or server initialize-time instructions) render into the `<Tools>` system-prompt section.

## Lifecycle

- Sessions own their MCP clients: lazy connect on first use, closed on `session.close()`.
- Streamable HTTP reattaches automatically.
- `session.mcp.refresh()` re-discovers tools mid-conversation (also exposed as the `/reload` command).
- Elicitation is advertised but mid-tool-call user input is auto-declined — there is no interactive UI in the headless core yet.

## See also

- [cli.md](cli.md) — `picobu mcp` subcommands
- [tools.md](tools.md) — how MCP tools join the built-in set
- [../configuration/options.md](../configuration/options.md) — `env:` references in `headers`/`env`
