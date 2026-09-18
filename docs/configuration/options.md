# Configuration reference

All Picobu settings live in one file: `~/.picobu/options.json`. It is created and seeded with defaults on first launch, guarded by a file lock, and rewritten with normalized values as needed. A corrupt file is backed up to `options.json.corrupt-<timestamp>` and re-seeded from scratch — your settings are never silently lost.

This page covers the file's structure, defaults, environment variables, and value-reference syntax. Providers and models are detailed in [providers.md](providers.md); the `statusLine` block in [status-line.md](status-line.md); the session layout blocks in [session-layout.md](session-layout.md); MCP servers in [../usage/mcp.md](../usage/mcp.md).

## Top-level blocks

| Key | Purpose | Default |
| --- | --- | --- |
| `providers` | AI providers with their models, billing, and capabilities | `[]` |
| `statusLine` | Maps provider ids to status chips on the session footer provider row | `[]` |
| `sessionStatusLayout` | Which segments render on the session status bar, and in what order | 4-line default (see [session-layout.md](session-layout.md)) |
| `sessionHeaderLayout` | Which segments render on the session header (max 1 line) | workspace, context, notification |
| `harness` | `defaultModel` (`"<providerId>/<modelId>"`), per-role model/thinking overrides, `maxAgents` | empty until first login or manual edit |
| `tui` | `theme` (`{key, variant: dark\|light}`, default `picobu/dark`) and `maxMessages` (default 20) | seeded on first run |
| `web` | Web server `{host, port}` — reserved; see note below | `{host: "0.0.0.0", port: 8080}` |
| `whatsapp` | `enabled` flag and `allowedNumbers` allow-list | `{enabled: false, allowedNumbers: []}` |
| `mcp` | MCP `servers` map | `{servers: {}}` |
| `watchdog` | Stale-run handling | 300000ms timeout, notification on, continue prompt off |

See [WhatsApp](../../README.md#whatsapp) in the root README for the `whatsapp` block.

### The `web` block

`web` is seeded, persisted, and normalized, but nothing binds a listener to it today — `picobu --server` bootstraps providers and runs the WhatsApp daemon without a web UI. Treat it as reserved for a future web frontend.

### Watchdog

| Key | Default | Meaning |
| --- | --- | --- |
| `staleTimeoutMs` | `300000` (5 minutes, floor 5000) | A run is stale after this much inactivity — see [../usage/sessions.md](../usage/sessions.md#watchdog) |
| `enableNotificationWhenStale` | `true` | Surface a stale-run notification |
| `enableContinuePromptWhenStale` | `false` | Offer a continue prompt on stale runs |

### Legacy keys

Two older key shapes are still read for compatibility and migrate on the next write: a top-level `theme` object falls back for `tui.theme`, and `defaults.model` falls back for `harness.defaultModel`.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PICOBU_SYSTEM_DIR` | Relocates the whole system dir (settings, sessions, auth, logs). Also honored by the ripgrep resolver. |
| `PICOBU_OAUTH_CALLBACK_HOST` | Host for OAuth loopback callbacks, default `127.0.0.1`. |
| `PICOBU_EXPERIMENTAL_MODELS` | Opt in to experimental model registration. |

API keys are **not** stored in `options.json` directly unless you paste them; the preferred shapes are environment references and OAuth references (below). OAuth credentials live in `~/.picobu/auth.json`, MCP tokens in `~/.picobu/mcp-auth.json`.

## Value references

String values in several blocks accept reference prefixes, resolved at use time:

| Syntax | Resolves to |
| --- | --- |
| `"env:VAR_NAME"` | The value of environment variable `VAR_NAME`. For MCP `headers`/`env`, an unset variable throws at connect time. |
| `"auth:<id>"` | The OAuth credential with id `<id>` from `~/.picobu/auth.json` (providers only). |

Example: `"apiKey": "env:ANTHROPIC_API_KEY"` on a provider, or `"headers": {"Authorization": "env:MY_TOKEN"}` on an MCP server.

## See also

- [providers.md](providers.md) — provider entries, model roles, OAuth login
- [status-line.md](status-line.md) — the `statusLine` block
- [session-layout.md](session-layout.md) — `sessionStatusLayout` / `sessionHeaderLayout`
- [../usage/mcp.md](../usage/mcp.md) — the `mcp` block
