import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { options, type ProviderModelBilling, type ProviderModelCapability, type ProviderModelOptions, type ProviderOptions } from "../../../libs/options";
import { initLockDir } from "../../../libs/lock";

initLockDir(options.app.systemDir);

export type ResolvedModel = {
  provider: ProviderOptions;
  modelId: string;
  model: LanguageModel;
  modelMeta: ProviderModelOptions;
};

/**
 * Resolve an `env:VAR` apiKey reference to the environment value at client
 * construction time, so the raw reference (not the secret) stays in the
 * settings store and UI. Non-reference values pass through unchanged.
 */
export const resolveApiKey = (apiKey?: string): string | undefined => {
  if (!apiKey) return undefined;
  return apiKey.startsWith("env:") ? process.env[apiKey.slice(4)] : apiKey;
};

export const createModelInstance = (provider: ProviderOptions, modelId: string) => {
  const apiKey = resolveApiKey(provider.apiKey);
  switch (provider.type) {
    case "anthropic":
      return createAnthropic({ baseURL: provider.baseUrl, apiKey, headers: provider.headers })(modelId);
    case "openai-compatible":
      return createOpenAICompatible({ baseURL: provider.baseUrl, name: provider.name, apiKey, headers: provider.headers })(modelId);
    case "openai-responses":
      return createOpenResponses({ url: provider.baseUrl, name: provider.name, apiKey, headers: provider.headers })(modelId);
    default:
      throw new Error(`Unsupported provider type: ${provider.type}. Available provider types: anthropic, openai-compatible, openai-responses`);
  }
}

export const resolveModel = (modelKey?: string): ResolvedModel => {
  const target = modelKey ?? options.harness?.defaultModel;
  const slash = target?.indexOf("/") ?? -1;
  const targetProviderId = target && slash > 0 ? target.slice(0, slash) : undefined;
  const targetModelId = target && slash > 0 ? target.slice(slash + 1) : undefined;
  const provider = targetProviderId ? options.providers.find((p) => p.id === targetProviderId) : undefined;
  const selectedProvider = provider ?? options.providers[0];

  if (!selectedProvider) {
    throw new Error("No AI provider configured in options (see ~/.picobu/options.json)");
  }

  const modelId = targetModelId && selectedProvider.models.some((m) => m.id === targetModelId) ? targetModelId : selectedProvider.models[0]?.id;

  if (!modelId) {
    throw new Error(`No model available for provider "${selectedProvider.id}"`);
  }

  const modelMeta = selectedProvider.models.find((m) => m.id === modelId);
  if (!modelMeta) {
    throw new Error(`No model metadata found for provider "${selectedProvider.id}" model "${modelId}"`);
  }

  return {
    provider: selectedProvider,
    modelId,
    model: createModelInstance(selectedProvider, modelId),
    modelMeta,
  };
};

export const resolveDefaultModel = (): ResolvedModel => resolveModel(options.harness?.defaultModel);

export type ModelEntry = {
  key: string;        // `<providerId>/<modelId>`
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;  // model.name ?? model.id
  supports: ProviderModelCapability[];
  context: number;
  output: number;
  billing?: ProviderModelBilling;
};

export function listModels(): ModelEntry[] {
  return options.providers.flatMap((p) =>
    p.models.map((m) => ({
      key: `${p.id}/${m.id}`,
      providerId: p.id,
      providerName: p.name,
      modelId: m.id,
      modelName: m.name ?? m.id,
      supports: m.supports ?? [],
      context: m.context,
      output: m.output,
      billing: m.billing,
    })),
  );
}

export const resolveDefaultModelKey = (): string => {
  const r = resolveDefaultModel();
  return `${r.provider.id}/${r.modelId}`;
};
