# MCP (Model Context Protocol)

Picobu connects to [MCP](https://modelcontextprotocol.io/) servers via `@ai-sdk/mcp` and merges their tools into every agent loop. Configure servers globally in `~/.picobu/options.json` under `mcp.servers`, and/or per project in `.mcp.json` (Claude-style `mcpServers` map); the project wins on id collision.

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

Malformed entries fail fast with a named error, e.g. `MCP server "fs" (stdio) requires "command"`, and `"env:VAR"` references to unset variables throw at connect time.

## Auth

`auth: true` servers use MCP OAuth:

```sh
picobu mcp login <serverId>    # PKCE flow, localhost:19888 callback
picobu mcp logout <serverId>   # drop stored tokens
```

Tokens live in `~/.picobu/mcp-auth.json` and refresh at connect.

## Discovery

- Tools are namespaced `mcp_<serverId>_<toolName>` (capped at 64 chars).
- All-tools agents get them automatically; explicit-tool agents opt in by name.
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
