import { options, updateSettings, type ProviderModelOptions, type ProviderOptions } from "@config/options.ts";
import type { LlmProviderDefinition } from "@agent/model/types.ts";
import { hyper } from "@agent/model/catalog-hyper.ts";
import { fetchModels } from "@agent/model/fetch-models.ts";
import { fetchModelsDevProvider, modelsFromModelsDev } from "@agent/model/catalog-models-dev.ts";


export const LLM_PROVIDERS: LlmProviderDefinition[] = [hyper];


export const upsertProvider = (providers: ProviderOptions[], provider: ProviderOptions): ProviderOptions[] => [
  ...providers.filter((p) => p.id !== provider.id),
  provider,
];


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
  const unchanged =
    !setDefaultModel && JSON.stringify(options.providers) === JSON.stringify(providers);
  if (unchanged) return;
  const next = await updateSettings({
    providers,
    ...(setDefaultModel ? { harness: { defaultModel: `${definition.id}/${firstModelId}` } } : {}),
  });

  
  
  options.providers = next.providers;
  if (next.harness) options.harness = next.harness;
};
