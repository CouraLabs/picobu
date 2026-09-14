import { hyper } from '@agent/model/catalog-hyper.ts'
import { fetchModelsDevProvider, listApiKeyModelsDevProviders, modelsFromModelsDev } from '@agent/model/catalog-models-dev.ts'
import { fetchModels } from '@agent/model/fetch-models.ts'
import { headersForProviderId } from '@agent/model/providers/index.ts'
import type { LlmProviderDefinition } from '@agent/model/types.ts'
import { options, type ProviderModelOptions, type ProviderOptions, updateSettings } from '@config/options.ts'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'

const typeForModelsDevNpm = (npm?: string): ProviderOptions['type'] => {
  switch (npm) {
    case '@ai-sdk/openai':
      return 'openai'
    case '@ai-sdk/anthropic':
      return 'anthropic'
    default:
      return 'openai-compatible'
  }
}

export const LLM_PROVIDERS: Array<LlmProviderDefinition> = [hyper]

const devModelNpm = (dev: ModelsDevProvider): Map<string, string> => {
  const map = new Map<string, string>()
  for (const model of Object.values(dev.models ?? {})) {
    if (typeof model.provider?.npm === 'string' && model.provider.npm.length > 0) map.set(model.id, model.provider.npm)
  }
  return map
}

const backfillProviderModelNpm = (providers: Array<ProviderOptions>, dev: ModelsDevProvider): { providers: Array<ProviderOptions>; changed: boolean } => {
  const npmByModel = devModelNpm(dev)
  if (npmByModel.size === 0) return { providers, changed: false }
  let changed = false
  const next = providers.map((provider) => {
    if (provider.id !== dev.id) return provider
    const models = provider.models.map((model) => {
      if (model.npm) return model
      const npm = npmByModel.get(model.id)
      if (!npm) return model
      changed = true
      return { ...model, npm }
    })
    return changed ? { ...provider, models } : provider
  })
  return { providers: next, changed }
}

export const upsertProvider = (providers: Array<ProviderOptions>, provider: ProviderOptions): Array<ProviderOptions> => [...providers.filter((p) => p.id !== provider.id), provider]

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? ''
}

export const autoloadLlmProviders = async (): Promise<void> => {
  for (const definition of LLM_PROVIDERS) {
    await autoloadProvider(definition).catch(() => {})
  }
  await autoloadApiKeyProviders().catch(() => {})
}

const providerFromModelsDev = (dev: ModelsDevProvider, apiKeyRef: string): ProviderOptions | undefined => {
  const models = modelsFromModelsDev(dev)
  if (models.length === 0) return undefined
  const npm = typeof dev.npm === 'string' && dev.npm.length > 0 ? dev.npm : '@ai-sdk/openai-compatible'
  const baseUrl = typeof dev.api === 'string' ? dev.api : ''
  return {
    id: dev.id,
    name: dev.name || dev.id,
    type: typeForModelsDevNpm(npm),
    baseUrl,
    apiKey: apiKeyRef,
    headers: headersForProviderId(dev.id),
    npm,
    models,
  }
}

export const autoloadApiKeyProviders = async (): Promise<void> => {
  const devProviders = await listApiKeyModelsDevProviders()
  let providers = options.providers
  let changed = false
  let firstNewModelKey: string | undefined
  for (const dev of devProviders) {
    if (!dev || typeof dev.id !== 'string') continue
    if (dev.id === 'github-copilot') continue
    if (providers.some((p) => p.id === dev.id && p.apiKey?.startsWith('auth:'))) continue
    const envName = (dev.env ?? []).find((name) => typeof process.env[name] === 'string' && (process.env[name]?.length ?? 0) > 0)
    if (!envName) continue
    if (providers.some((p) => p.id === dev.id)) {
      const backfilled = backfillProviderModelNpm(providers, dev)
      if (backfilled.changed) {
        providers = backfilled.providers
        changed = true
      }
      continue
    }
    const provider = providerFromModelsDev(dev, `env:${envName}`)
    if (!provider) continue
    providers = upsertProvider(providers, provider)
    changed = true
    firstNewModelKey ??= provider.models[0] ? `${provider.id}/${provider.models[0].id}` : undefined
  }
  if (!changed) return
  const setDefaultModel = !options.harness?.defaultModel && firstNewModelKey
  const next = await updateSettings({
    providers,
    ...(setDefaultModel ? { harness: { ...options.harness, defaultModel: firstNewModelKey } } : {}),
  })
  options.providers = next.providers
  if (next.harness) options.harness = next.harness
}

const autoloadProvider = async (definition: LlmProviderDefinition): Promise<void> => {
  const apiKey = process.env[definition.apiKeyEnv]
  if (!apiKey) return
  const apiKeyRef = `env:${definition.apiKeyEnv}`
  let models: Array<ProviderModelOptions> = []
  try {
    models = await fetchModels(definition.modelsUrl, apiKey)
  } catch (error) {
    console.error(`picobu: failed to fetch models for ${definition.id}:`, error)
  }
  if (models.length === 0) {
    const modelsDevProvider = await fetchModelsDevProvider(definition.apiKeyEnv)
    if (modelsDevProvider) models = modelsFromModelsDev(modelsDevProvider)
  }
  const firstModelId = models[0]?.id
  if (!firstModelId) return
  const provider: ProviderOptions = {
    id: definition.id,
    name: definition.name,
    type: definition.type,
    baseUrl: definition.baseUrl,
    apiKey: apiKeyRef,
    headers: headersForProviderId(definition.id),
    npm: '@ai-sdk/openai-compatible',
    models,
  }
  const providers = upsertProvider(options.providers, provider)
  const setDefaultModel = !options.harness?.defaultModel
  const unchanged = !setDefaultModel && stableStringify(options.providers) === stableStringify(providers)
  if (unchanged) return
  const next = await updateSettings({
    providers,
    ...(setDefaultModel ? { harness: { ...options.harness, defaultModel: `${definition.id}/${firstModelId}` } } : {}),
  })
  options.providers = next.providers
  if (next.harness) options.harness = next.harness
}
