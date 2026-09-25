# Providers, models, and login

Picobu talks to any provider the Vercel AI SDK supports. Providers are declared in `~/.picobu/options.json` under `providers`, selected via `harness`, and can also be registered automatically from the models.dev catalog or from an OAuth login. Key-value references like `"env:VAR"` are explained in [options.md](options.md).

## Provider entries

| Field | Meaning |
| --- | --- |
| `id` | Identifier used by `harness.defaultModel` and `statusLine` (`"<providerId>/<modelId>"`) |
| `name` | Display name |
| `type` | SDK adapter: `openai`, `openai-compatible`, `openai-responses`, or `anthropic` |
| `baseUrl` | API base URL |
| `apiKey` | Literal key, `"env:VAR_NAME"`, or `"auth:<id>"` for an OAuth credential |
| `headers` | Extra HTTP headers |
| `npm` | The `@ai-sdk/*` factory package used at runtime (catalog autoload sets this) |
| `models` | Array of model entries |

Model fields: `id`, `name`, `context` (token window), `output` (max output tokens), `reasoning`, `efforts` (supported thinking levels), `defaultEffort`, `supports` (e.g. `["text", "vision"]`), `billing` (`input`, `output`, `cacheRead`, `cacheWrite`, `multiplier`, `batchSize` — per-million rates used for cost accounting), and `status` (`alpha`, `beta`, `active`, `deprecated`).

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "env:ANTHROPIC_API_KEY",
      "models": [
        {
          "id": "claude-sonnet-4-5",
          "name": "Claude Sonnet 4.5",
          "context": 200000,
          "output": 64000,
          "reasoning": true,
          "efforts": ["none", "low", "medium", "high"],
          "defaultEffort": "medium",
          "supports": ["text", "vision"],
          "billing": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
        }
      ]
    }
  ],
  "harness": {
    "defaultModel": "anthropic/claude-sonnet-4-5",
    "modelRoles": {
      "tiny": "anthropic/claude-haiku-4-5",
      "flash": "anthropic/claude-sonnet-4-5",
      "flashThinking": "medium",
      "heavy": "anthropic/claude-opus-4-5",
      "heavyThinkingLevel": "high"
    },
    "maxAgents": 4
  }
}
```

## Catalog autoload

At startup, Picobu loads every [models.dev](https://models.dev) provider (via `@opencode-ai/models`) whose `env` vars are set — trying the live catalog first and falling back to the bundled snapshot. Each provider's `npm` field selects the `@ai-sdk/*` factory, and provider folders under `src/agent/model/providers/` add special headers where needed (e.g. OpenRouter attribution). Charm Hyper additionally tries a live `/v1/models` fetch before the catalog fallback.

Common autoload keys: `HYPER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` — plus every models.dev provider with an `env` entry (Gemini, Mistral, Groq, DeepSeek, Cerebras, Cohere, Together, Perplexity, Azure, Bedrock, Vertex, and more). Run `picobu --help` for the full list.

## Harness and model roles

`harness.defaultModel` is `"<providerId>/<modelId>"` and backs every role that has no specific override.

| Role | Purpose | Default thinking |
| --- | --- | --- |
| `tiny` | Fast, cheap lookups (session titles) | `none` |
| `flash` | Default workhorse for the `ask` and `coder` agents | `flashThinking` |
| `flashThinking` | Thinking level for `flash` | `medium` |
| `heavy` | The `grill` and `plan-code` agents | `heavyThinkingLevel` |
| `heavyThinkingLevel` | Thinking level for `heavy` | `high` |

The conversational agents map to a role (`ask`/`coder` → `flash`, `grill`/`plan-code` → `heavy`; `persistent` has no role and runs on `flash`); switching agent in the TUI re-resolves its model and thinking from that role.

`harness.maxAgents` (default `4`) caps concurrent spawned sub sessions tree-wide. options.json requires it to be ≥ 1; the `SessionManager` library API accepts `0` to disable spawning entirely.

## OAuth login

Subscription providers can be used without API keys. Credentials live in `~/.picobu/auth.json` (never `options.json`); logging in registers the provider with `apiKey: "auth:<id>"` and models from the models.dev catalog. Tokens refresh automatically at bootstrap, and a first-time login also becomes `harness.defaultModel`.

```sh
picobu login                    # list OAuth provider status
picobu login --help             # show provider ids
picobu login <provider> [opts]  # start a login
picobu logout <provider>        # logout and repoint harness selectors
```

| Provider | `type` | Notes |
| --- | --- | --- |
| `openai` | `openai` | ChatGPT browser OAuth (PKCE, local callback), or `picobu login openai headless` for the device flow; live `/v1/models` intersected with the catalog so only accessible models register |
| `anthropic` | `anthropic` | Claude browser OAuth (PKCE, local callback); live `/v1/models` intersected with the catalog |
| `github-copilot` | `openai-compatible` | Device-code flow; base URL from the token `proxy-ep`; usable models filtered opencode-style (policy, limits, `tool_calls`) and intersected with the catalog |
| `xai` | `openai-compatible` | xAI device-code flow (SuperGrok subscription); `@ai-sdk/xai` |
| `openrouter` | `openai-compatible` | PKCE loopback exchanged for a permanent API key; `@openrouter/ai-sdk-provider` |
| `kimi-coding` | `openai-compatible` | Kimi Code subscription device flow; base `https://api.kimi.com/coding` |
| `digitalocean` | `openai-compatible` | Browser OAuth implicit flow; inference base `https://inference.do-ai.run/v1` |
| `snowflake-cortex` | `openai-compatible` | PKCE; `picobu login snowflake-cortex <account> [role]` |
| `azure` | `openai-compatible` | Microsoft Entra ID via `az login`; `picobu login azure <resource-name>`; `@ai-sdk/azure` |

Provider-specific options (`[opts]`): enterprise domain for Copilot, `headless` for OpenAI, `<account> [role]` for Snowflake, `<resource-name>` for Azure.

Aliases: `copilot` → `github-copilot`, `claude` → `anthropic`, `chatgpt`/`codex` → `openai`, `kimi` → `kimi-coding`, `snowflake` → `snowflake-cortex`, `do` → `digitalocean`.

`openrouter`, `kimi-coding`, `digitalocean`, `snowflake-cortex`, and `azure` were ported from Pi/opencode and are untested end-to-end.

`picobu login` with an existing valid credential verifies it, refreshes the provider registration, and asks before re-logging in; pass `-f/--force` to skip that check.

## See also

- [options.md](options.md) — the file these blocks live in, plus `env:`/`auth:` references
- [status-line.md](status-line.md) — provider status chips
- [../usage/cli.md](../usage/cli.md) — `login`/`logout` command details
