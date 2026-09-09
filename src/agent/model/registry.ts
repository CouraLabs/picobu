import { hyper } from "@agent/model/catalog-hyper.ts";
import { fetchModelsDevProvider, modelsFromModelsDev } from "@agent/model/catalog-models-dev.ts";
import { fetchModels } from "@agent/model/fetch-models.ts";
import type { LlmProviderDefinition } from "@agent/model/types.ts";
import { options, type ProviderModelOptions, type ProviderOptions, updateSettings } from "@config/options.ts";

export const LLM_PROVIDERS: LlmProviderDefinition[] = [hyper];

export const upsertProvider = (providers: ProviderOptions[], provider: ProviderOptions): ProviderOptions[] => [
  ...providers.filter((p) => p.id !== provider.id),
  provider,
];

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "";
};

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
  } catch (error) {
    console.error(`picobu: failed to fetch models for ${definition.id}:`, error);
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
    apiKey: apiKeyRef,
    models,
  };
  const providers = upsertProvider(options.providers, provider);
  const setDefaultModel = !options.harness?.defaultModel;
  const unchanged = !setDefaultModel && stableStringify(options.providers) === stableStringify(providers);
  if (unchanged) return;
  const next = await updateSettings({
    providers,
    ...(setDefaultModel ? { harness: { ...options.harness, defaultModel: `${definition.id}/${firstModelId}` } } : {}),
  });
  options.providers = next.providers;
  if (next.harness) options.harness = next.harness;
};
