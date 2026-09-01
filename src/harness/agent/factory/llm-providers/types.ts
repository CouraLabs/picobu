/**
 * A built-in custom LLM provider that can auto-discover itself at startup:
 * when the env var named by `apiKeyEnv` holds a value, the provider fetches its
 * OpenAI-compatible `/models` listing and merges itself into
 * `~/.picobu/options.json` (falling back to models.dev metadata).
 */
export type LlmProviderDefinition = {
  /** Provider id used in `<providerId>/<modelId>` model keys. */
  id: string;
  /** Display name shown by the model picker. */
  name: string;
  /** AI SDK provider type; custom providers are OpenAI-compatible today. */
  type: "openai-compatible";
  /** Base URL passed to the AI SDK client. */
  baseUrl: string;
  /** OpenAI-compatible models listing endpoint (GET, bearer auth). */
  modelsUrl: string;
  /** Environment variable holding the API key; the provider only loads when set. */
  apiKeyEnv: string;
};
