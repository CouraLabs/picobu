import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { options, type ProviderModelBilling, type ProviderModelCapability, type ProviderModelOptions, type ProviderOptions } from "@config/options.ts";
import { oauthAuthById } from "@auth/index.ts";
import { getCredential } from "@auth/store.ts";
import { initLockDir } from "@shared/lock.ts";

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

/**
 * Resolve a provider's request auth synchronously. `auth:<id>` refs (written
 * by `/login`) read the stored OAuth credential; the async `ensureOAuthTokens`
 * pass before each run keeps those fresh. A missing credential throws (the
 * run path surfaces it as a friendly guidance error); a *stale* credential is
 * handed over best-effort so app mount / status rendering never crashes on an
 * offline box — the next run-start refresh retries, and a truly expired token
 * surfaces as a provider 401 instead. Everything else falls back to
 * `resolveApiKey` (`env:` refs / literal keys).
 */
export const resolveAuth = (provider: ProviderOptions): { apiKey?: string; baseUrl?: string } => {
  const ref = provider.apiKey;
  if (!ref?.startsWith("auth:")) return { apiKey: resolveApiKey(ref) };
  const id = ref.slice("auth:".length);
  const credential = getCredential(id);
  if (!credential) {
    throw new Error(`No saved login for "${id}". Run /login ${id} to authenticate.`);
  }
  const auth = oauthAuthById(id);
  return auth ? auth.toAuth(credential) : { apiKey: credential.access };
};

export const createModelInstance = (provider: ProviderOptions, modelId: string) => {
  const auth = resolveAuth(provider);
  const apiKey = auth.apiKey;
  // Copilot's base URL is account/token-dependent (derived by `toAuth`);
  // everything else uses the static provider config.
  const baseUrl = auth.baseUrl ?? provider.baseUrl;
  switch (provider.type) {
    case "openai":
      return createOpenAI({ baseURL: baseUrl, apiKey, headers: provider.headers })(modelId);
    case "anthropic":
      return createAnthropic({ baseURL: baseUrl, apiKey, headers: provider.headers })(modelId);
    case "openai-compatible":
      return createOpenAICompatible({ baseURL: baseUrl, name: provider.name, apiKey, headers: provider.headers })(modelId);
    case "openai-responses":
      return createOpenResponses({ url: baseUrl, name: provider.name, apiKey, headers: provider.headers })(modelId);
    default:
      throw new Error(`Unsupported provider type: ${provider.type}. Available provider types: openai, anthropic, openai-compatible, openai-responses`);
  }
}

/** Resolve `<providerId>/<modelId>` (and metadata) without constructing a
 *  model client, so import-time default-model resolution can never touch the
 *  auth layer or an apiKey. */
export const resolveModelRef = (modelKey?: string): Omit<ResolvedModel, "model"> => {
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

  return { provider: selectedProvider, modelId, modelMeta };
};

export const resolveModel = (modelKey?: string): ResolvedModel => {
  const ref = resolveModelRef(modelKey);
  return { ...ref, model: createModelInstance(ref.provider, ref.modelId) };
};

export const resolveDefaultModel = (): ResolvedModel => resolveModel(options.harness?.defaultModel);

/** Default-model key without constructing a client (safe at import time). */
export const resolveDefaultModelKey = (): string => {
  const ref = resolveModelRef(options.harness?.defaultModel);
  return `${ref.provider.id}/${ref.modelId}`;
};

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
