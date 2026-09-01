import { options, updateSettings, type ProviderModelOptions, type ProviderOptions } from "../../../../libs/options";
import type { LlmProviderDefinition } from "./types";
import { hyper } from "./hyper";
import { fetchModels } from "./fetch-models";
import { fetchModelsDevProvider, modelsFromModelsDev } from "./models-dev";

/** Built-in custom providers that autoload themselves when their API key env var is set. */
export const LLM_PROVIDERS: LlmProviderDefinition[] = [hyper];

/** Insert/replace a provider by id, preserving the order of the other entries. */
export const upsertProvider = (providers: ProviderOptions[], provider: ProviderOptions): ProviderOptions[] => [
  ...providers.filter((p) => p.id !== provider.id),
  provider,
];

/**
 * Discover every registered custom provider whose API key env var is set,
 * fetch its models (its own `/models` endpoint, falling back to the models.dev
 * catalog), and merge the result into `~/.picobu/options.json` — also syncing
 * the in-memory `options` singleton so the running app sees the provider
 * without a restart. Sets `harness.defaultModel` when the config has none.
 * Never throws: a provider that cannot be resolved is skipped.
 */
export const autoloadLlmProviders = async (): Promise<void> => {
  for (const definition of LLM_PROVIDERS) {
    await autoloadProvider(definition).catch(() => {});
  }
};

const autoloadProvider = async (definition: LlmProviderDefinition): Promise<void> => {
  const apiKey = process.env[definition.apiKeyEnv];
  if (!apiKey) return;
  const apiKeyRef = `env:${definition.apiKeyEnv}`;

  let models: ProviderModelOptions[] = [];
  try {
    models = await fetchModels(definition.modelsUrl, apiKey);
  } catch {
    // Provider listing unavailable — models.dev below decides.
  }

  if (models.length === 0) {
    const modelsDevProvider = await fetchModelsDevProvider(definition.apiKeyEnv);
    if (modelsDevProvider) models = modelsFromModelsDev(modelsDevProvider);
  }

  const firstModelId = models[0]?.id;
  if (!firstModelId) return;

  const provider: ProviderOptions = {
    id: definition.id,
    name: definition.name,
    type: definition.type,
    baseUrl: definition.baseUrl,
    // The raw secret never reaches disk: store the env reference and let
    // `resolveApiKey` read the env var at client-construction time.
    apiKey: apiKeyRef,
    models,
  };

  const providers = upsertProvider(options.providers, provider);
  const setDefaultModel = !options.harness?.defaultModel;
  const unchanged =
    !setDefaultModel && JSON.stringify(options.providers) === JSON.stringify(providers);
  if (unchanged) return;

  const next = await updateSettings({
    providers,
    ...(setDefaultModel ? { harness: { defaultModel: `${definition.id}/${firstModelId}` } } : {}),
  });

  // `updateSettings` only writes the file; mirror the merged result onto the
  // in-memory singleton so `listModels`/`resolveModel` pick it up immediately.
  options.providers = next.providers;
  if (next.harness) options.harness = next.harness;
};
