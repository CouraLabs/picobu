# Providers and models

Picobu talks to any provider the Vercel AI SDK supports. Providers are declared in `~/.picobu/options.json` under `providers`, selected via `harness`, and can also be registered automatically from the models.dev catalog or by probing local endpoints. Key-value references like `"env:VAR"` are explained in [options.md](options.md).

## Provider entries

| Field | Meaning |
| --- | --- |
| `id` | Identifier used by `harness.defaultModel` and `statusLine` (`"<providerId>/<modelId>"`) |
| `name` | Display name |
| `type` | SDK adapter: `openai`, `openai-compatible`, `openai-responses`, or `anthropic` (aliases: `anthropic-compatible`, `openai-responses-compatible`) |
| `baseUrl` | API base URL. For `openai-responses`, either the base or the full `/responses` URL |
| `apiKey` | Literal key or `"env:VAR_NAME"`. Optional — omit it for keyless servers (Ollama, LM Studio, local LiteLLM). With no `apiKey`, `anthropic`- and `openai`-type providers send the `picobu-keyless` placeholder instead of an empty key; `openai-compatible` / `openai-responses` omit the `Authorization` header entirely |
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

Common autoload keys: `HYPER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY` — plus every models.dev provider with an `env` entry (Gemini, Mistral, Groq, DeepSeek, Cerebras, Cohere, Together, Perplexity, Azure, Bedrock, Vertex, and more). Run `picobu --help` for the full list.

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

## Local and compatible endpoints

LiteLLM, Ollama and LM Studio are probed at startup and registered automatically when they answer on their default port (or on their env override). Models come from `<baseUrl>/models`, and **API keys are optional** for these three — an `openai-compatible` endpoint with no key sends no `Authorization` header at all.

| Endpoint | Default `baseUrl` | Env overrides |
| --- | --- | --- |
| LiteLLM | `http://localhost:4000/v1` | `LITELLM_BASE_URL`, `LITELLM_API_KEY` (optional) |
| Ollama | `http://localhost:11434/v1` | `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` (optional) |
| LM Studio | `http://localhost:1234/v1` | `LMSTUDIO_BASE_URL`, `LMSTUDIO_API_KEY` (optional) |

A preset is skipped when a provider with the same `id` already exists in `options.json`, so declaring one by hand always wins.

LiteLLM is the recommended way to reach subscription providers: it already implements the provider-specific flows (browser and device login, token refresh) that Picobu's own OAuth support used to cover, and it exposes everything behind one OpenAI-compatible endpoint.

To pin a custom base URL, a key, or a specific model list, declare the provider in `options.json` instead. The first two below are keyless `openai-compatible`; the last two show an `anthropic`- and an `openai-responses`-compatible server:

```json
{
  "providers": [
    {
      "id": "litellm",
      "name": "LiteLLM",
      "type": "openai-compatible",
      "baseUrl": "http://localhost:4000/v1",
      "apiKey": "env:LITELLM_API_KEY",
      "npm": "@ai-sdk/openai-compatible",
      "models": [{ "id": "gpt-4o", "name": "GPT-4o", "context": 128000, "output": 16384, "supports": ["text"] }]
    },
    {
      "id": "ollama",
      "name": "Ollama",
      "type": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "npm": "@ai-sdk/openai-compatible",
      "models": [{ "id": "llama3.2", "name": "Llama 3.2", "context": 131072, "output": 8192, "supports": ["text"] }]
    },
    {
      "id": "lmstudio",
      "name": "LM Studio",
      "type": "openai-compatible",
      "baseUrl": "http://localhost:1234/v1",
      "npm": "@ai-sdk/openai-compatible",
      "models": [{ "id": "qwen/qwen3.8-27b", "name": "Qwen3.8 27B", "context": 32768, "output": 8192, "supports": ["text"] }]
    }
  ]
}
```

Anthropic-compatible and OpenAI-Responses-compatible servers work the same way, with a different `type`/`npm` pair:

```json
{
  "providers": [
    {
      "id": "local-claude",
      "name": "Local Claude",
      "type": "anthropic",
      "baseUrl": "http://localhost:9000",
      "apiKey": "local",
      "npm": "@ai-sdk/anthropic",
      "models": [{ "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5", "context": 200000, "output": 64000, "supports": ["text"] }]
    },
    {
      "id": "local-responses",
      "name": "Local Responses",
      "type": "openai-responses",
      "baseUrl": "http://localhost:8000/v1",
      "npm": "@ai-sdk/openai",
      "models": [{ "id": "gpt-5", "name": "GPT-5", "context": 200000, "output": 64000, "supports": ["text"] }]
    }
  ]
}
```

`type` accepts the aliases `anthropic-compatible` and `openai-responses-compatible`. For `openai-responses`, `baseUrl` may be either the base (`http://localhost:8000/v1`) or the full endpoint (`http://localhost:8000/v1/responses`) — Picobu appends `/responses` only when it is missing.

An `anthropic`-type provider may omit `apiKey`. Picobu then sends the literal placeholder `picobu-keyless` rather than leaving the field empty, which deliberately shadows any ambient `ANTHROPIC_API_KEY` so a local proxy never receives your real key. Point it at whatever your proxy accepts (the example uses the literal `"local"`), or supply a real key through `env:VAR` — a genuine Anthropic endpoint answers the placeholder with a 401. `openai-compatible` and `openai-responses` behave differently: with no `apiKey` the `Authorization` header is omitted entirely, so omit the field for a keyless server.

You do not have to hand-edit `options.json`: ask the **Picobu Optioneer** agent to add a provider and it writes a validated patch through the `update-options` tool, then reloads. Note that `providers` is replaced wholesale, so the Optioneer always sends the complete array.

## See also

- [options.md](options.md) — the file these blocks live in, plus `env:` references
- [status-line.md](status-line.md) — provider status chips
- [../usage/cli.md](../usage/cli.md) — `mcp login`/`mcp logout` and the other subcommands
