import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenResponses } from '@ai-sdk/open-responses'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { oauthAuthById } from '@auth/index.ts'
import { getCredential } from '@auth/store.ts'
import { options, type ProviderModelBilling, type ProviderModelCapability, type ProviderModelOptions, type ProviderOptions } from '@config/options.ts'
import { initLockDir } from '@shared/lock.ts'
import type { LanguageModel } from 'ai'

initLockDir(options.app.systemDir)

export type ResolvedModel = {
  provider: ProviderOptions
  modelId: string
  model: LanguageModel
  modelMeta: ProviderModelOptions
}

export const resolveApiKey = (apiKey?: string): string | undefined => {
  if (!apiKey) return undefined
  return apiKey.startsWith('env:') ? process.env[apiKey.slice(4)] : apiKey
}

export const resolveAuth = (provider: ProviderOptions): { apiKey?: string; baseUrl?: string } => {
  const ref = provider.apiKey
  if (!ref?.startsWith('auth:')) return { apiKey: resolveApiKey(ref) }
  const id = ref.slice('auth:'.length)
  const credential = getCredential(id)
  if (!credential) {
    throw new Error(`No saved login for "${id}". Run /login ${id} to authenticate.`)
  }
  const auth = oauthAuthById(id)
  return auth ? auth.toAuth(credential) : { apiKey: credential.access }
}

export const createModelInstance = (provider: ProviderOptions, modelId: string) => {
  const auth = resolveAuth(provider)
  const apiKey = auth.apiKey
  const baseUrl = auth.baseUrl ?? provider.baseUrl
  switch (provider.type) {
    case 'openai':
      return createOpenAI({ baseURL: baseUrl, apiKey, headers: provider.headers })(modelId)
    case 'anthropic':
      return createAnthropic({ baseURL: baseUrl, apiKey, headers: provider.headers })(modelId)
    case 'openai-compatible':
      return createOpenAICompatible({ baseURL: baseUrl, name: provider.name, apiKey, headers: provider.headers })(modelId)
    case 'openai-responses':
      return createOpenResponses({ url: baseUrl, name: provider.name, apiKey, headers: provider.headers })(modelId)
    default:
      throw new Error(`Unsupported provider type: ${provider.type}. Available provider types: openai, anthropic, openai-compatible, openai-responses`)
  }
}

export const resolveModelRef = (modelKey?: string): Omit<ResolvedModel, 'model'> => {
  const target = modelKey ?? options.harness?.defaultModel
  if (!target) {
    const selectedProvider = options.providers[0]
    if (!selectedProvider) {
      throw new Error('No AI provider configured in options (see ~/.picobu/options.json)')
    }
    const modelId = selectedProvider.models[0]?.id
    if (!modelId) {
      throw new Error(`No model available for provider "${selectedProvider.id}"`)
    }
    const modelMeta = selectedProvider.models.find((m) => m.id === modelId)
    if (!modelMeta) {
      throw new Error(`No model metadata found for provider "${selectedProvider.id}" model "${modelId}"`)
    }
    return { provider: selectedProvider, modelId, modelMeta }
  }
  const slash = target.indexOf('/')
  if (slash <= 0) {
    const provider = options.providers.find((p) => p.id === target)
    if (!provider) {
      throw new Error(`Unknown provider "${target}". Known providers: ${options.providers.map((p) => p.id).join(', ') || 'none'}`)
    }
    const modelId = provider.models[0]?.id
    if (!modelId) {
      throw new Error(`No model available for provider "${provider.id}"`)
    }
    const modelMeta = provider.models.find((m) => m.id === modelId)
    if (!modelMeta) {
      throw new Error(`No model metadata found for provider "${provider.id}" model "${modelId}"`)
    }
    return { provider, modelId, modelMeta }
  }
  const targetProviderId = target.slice(0, slash)
  const targetModelId = target.slice(slash + 1)
  const provider = options.providers.find((p) => p.id === targetProviderId)
  if (!provider) {
    throw new Error(`Unknown provider "${targetProviderId}". Known providers: ${options.providers.map((p) => p.id).join(', ') || 'none'}`)
  }
  if (!targetModelId) {
    throw new Error(`Unknown model "${target}". Expected "<providerId>/<modelId>"`)
  }
  const modelMeta = provider.models.find((m) => m.id === targetModelId)
  if (!modelMeta) {
    throw new Error(`Unknown model "${targetModelId}" for provider "${targetProviderId}". Known models: ${provider.models.map((m) => m.id).join(', ') || 'none'}`)
  }
  return { provider, modelId: targetModelId, modelMeta }
}

export const resolveModel = (modelKey?: string): ResolvedModel => {
  const ref = resolveModelRef(modelKey)
  return { ...ref, model: createModelInstance(ref.provider, ref.modelId) }
}

export const resolveDefaultModel = (): ResolvedModel => resolveModel(options.harness?.defaultModel)

export const resolveDefaultModelKey = (): string => {
  const ref = resolveModelRef(options.harness?.defaultModel)
  return `${ref.provider.id}/${ref.modelId}`
}

export type ModelEntry = {
  key: string
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  supports: ProviderModelCapability[]
  context: number
  output: number
  billing?: ProviderModelBilling
}

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
  )
}
