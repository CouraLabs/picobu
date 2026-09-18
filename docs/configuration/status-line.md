# Provider status line

The optional top-level `statusLine` array (a sibling of `providers` in `~/.picobu/options.json`) maps a provider id to status chips shown on the session footer's provider row. This keeps usage metrics — rate limits, credits, balances — visible without editing the provider entries themselves.

```json
{
  "statusLine": [
    {
      "provider": "hyper",
      "items": [
        { "label": "Rate Day", "type": "header", "value": "x-ratelimit-remaining-day" },
        { "label": "Rate Hour", "type": "header", "value": "x-ratelimit-remaining-hour" },
        { "label": "Run HyperCredits", "type": "step-raw", "value": "cost.hypercredits" },
        { "label": "HyperCredits", "type": "endpoint", "endpoint": "/credits", "value": "balance" }
      ]
    }
  ]
}
```

## Item types

| `type` | `value` source | Fetched |
| --- | --- | --- |
| `header` | Response header name (case-insensitive) from the last step | Every step |
| `step-raw` | Dot-path (e.g. `cost.hypercredits`, `balances.0.total`) inside the last step's `usage.raw` provider payload | Every step |
| `endpoint` | Dot-path into the JSON returned by `endpoint`, fetched with the provider's own auth (`env:` api key or `auth:<id>` oauth, sent as `Bearer`) | Session start, run start + run end |

## Endpoint rules

- An `endpoint` starting with `http://`/`https://` is used as-is; anything else is joined to the provider `baseUrl` — so `/credits` and `credits` are equivalent.
- Results persist in the session stats file; a failed fetch keeps the last value.
- Fetching never blocks a run: 10s timeout, fire-and-forget.
- Objects render as JSON; a missing value renders as `Label -`.

## Validation and limits

- At most 8 items per provider (`MAX_STATUS_LINE_ITEMS`).
- `label` and `value` must be non-empty strings, or the item is dropped.
- An `endpoint` item is dropped unless `endpoint` starts with `/` or `http(s)://`.
- Entries whose `provider` doesn't match a configured provider are ignored.

## Built-in defaults

The `hyper` (Charm Hyper) provider ships with the defaults shown in the example: per-response day/hour rate-limit headers, per-run HyperCredits from the step payload, and account balance polled on run start/end. Missing entries are backfilled automatically — your edits are never overwritten.

## See also

- [options.md](options.md) — where `statusLine` lives
- [../usage/sessions.md](../usage/sessions.md) — the session footer rows
