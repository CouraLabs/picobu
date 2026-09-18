# Session layout

Two option blocks control which segments the TUI renders on the session header (top of the page) and the session status bar (the footer under the prompt), and in what order: `sessionHeaderLayout` and `sessionStatusLayout` in `~/.picobu/options.json`. Both are seeded with defaults on first launch and normalized on every read — unknown ids, duplicate ids, and stray separators are dropped rather than erroring.

Both share the same shape:

```json
{
  "sessionStatusLayout": {
    "lines": [
      ["agent", "separator", "model", "separator", "effort"],
      ["ttft", "tps", "cost"]
    ],
    "columnGap": 1,
    "rowGap": 0
  }
}
```

A bare `lines` array is also accepted in place of the object. `columnGap`/`rowGap` are clamped to 0–4; defaults are 1 and 0.

## Status bar items

Status layout allows up to 6 lines with up to 32 items per line. `separator` inserts a visual gap between segments.

| Id | Display label |
| --- | --- |
| `agent` | Agent |
| `model` | Model |
| `effort` | Thinking effort |
| `run-state` | Run state |
| `loading` | Loading spinner |
| `session-title` | Session title |
| `todo` | Todos |
| `ttft` | TTFT |
| `tps` | Tokens/s |
| `tool-time` | Tool exec time |
| `input` | Input tokens |
| `output` | Output tokens |
| `cache` | Cache |
| `cost` | Cost |
| `sandbox` | Sandbox |
| `msgs` | Messages |
| `tools` | Tool calls |
| `mcp` | MCP |
| `queue` | Queue |
| `jobs` | Background jobs |
| `provider-items` | Provider items (the `statusLine` chips — see [status-line.md](status-line.md)) |
| `separator` | Separator |

## Header items

The header allows exactly 1 line.

| Id | Display label |
| --- | --- |
| `workspace` | Workspace (folder + git) |
| `context` | Context |
| `notification` | Notification |
| `separator` | Separator |

## Defaults

Status bar default (4 lines):

```json
[
  ["agent", "separator", "model", "separator", "effort", "separator", "run-state", "separator", "loading", "session-title"],
  ["ttft", "tps", "separator", "input", "output", "cache", "cost"],
  ["sandbox", "separator", "msgs", "tools", "separator", "queue", "separator", "jobs"],
  ["provider-items"]
]
```

Header default (1 line): `["workspace", "separator", "context", "separator", "notification"]`.

Empty segments (e.g. no tool time yet) render as `0` rather than disappearing.

## Editing without hand-writing JSON

The TUI ships editors for both layouts:

- `/session-status-view` (aliases `/session-status`, `/status-view`) — status bar: lines, items, column/row gaps.
- `/session-header-view` (aliases `/session-header`, `/header-view`) — header: workspace, context, notification.

In the dialog: arrows move the cursor, `enter` picks up or drops an item, `del` moves it to Unused, `esc` closes.

## See also

- [status-line.md](status-line.md) — the `provider-items` chips
- [options.md](options.md) — where the blocks live
- [../usage/sessions.md](../usage/sessions.md) — what each segment measures
