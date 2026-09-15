import { hyper } from '@agent/model/catalog-hyper.ts'
import { fetchModelsDevProvider, listApiKeyModelsDevProviders, modelsFromModelsDev } from '@agent/model/catalog-models-dev.ts'
import { fetchModels } from '@agent/model/fetch-models.ts'
import { headersForProviderId } from '@agent/model/providers/index.ts'
import { getRuntimeApiKeyProviders, setRuntimeApiKeyProviders } from '@agent/model/runtime-providers.ts'
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

export const upsertProvider = (providers: Array<ProviderOptions>, provider: ProviderOptions): Array<ProviderOptions> => [...providers.filter((p) => p.id !== provider.id), provider]

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

const ensureDefaultModel = async (candidates: Array<ProviderOptions>): Promise<void> => {
  if (options.harness?.defaultModel) return
  const first = candidates[0]
  const firstModelId = first?.models[0]?.id
  if (!first || !firstModelId) return
  const next = await updateSettings({
    harness: {
      ...options.harness,
      defaultModel: `${first.id}/${firstModelId}`,
    },
  })
  options.harness = next.harness
}

const loadProviderFromDefinition = async (definition: LlmProviderDefinition): Promise<ProviderOptions | undefined> => {
  if (options.providers.some((provider) => provider.id === definition.id)) return undefined
  const apiKey = process.env[definition.apiKeyEnv]
  if (!apiKey) return undefined
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
  if (!models[0]) return undefined
  return {
    id: definition.id,
    name: definition.name,
    type: definition.type,
    baseUrl: definition.baseUrl,
    apiKey: apiKeyRef,
    headers: headersForProviderId(definition.id),
    npm: '@ai-sdk/openai-compatible',
    models,
  }
}

const loadApiKeyProviders = async (): Promise<Array<ProviderOptions>> => {
  const configured = new Set(options.providers.map((provider) => provider.id))
  const devProviders = await listApiKeyModelsDevProviders()
  const runtime: Array<ProviderOptions> = []
  for (const dev of devProviders) {
    if (!dev || typeof dev.id !== 'string') continue
    if (dev.id === 'github-copilot') continue
    if (configured.has(dev.id)) continue
    const envName = (dev.env ?? []).find((name) => typeof process.env[name] === 'string' && (process.env[name]?.length ?? 0) > 0)
    if (!envName) continue
    const provider = providerFromModelsDev(dev, `env:${envName}`)
    if (!provider) continue
    if (runtime.some((item) => item.id === provider.id)) continue
    runtime.push(provider)
  }
  return runtime
}

export const autoloadApiKeyProviders = async (): Promise<void> => {
  const apiKeyProviders = await loadApiKeyProviders().catch(() => [] as Array<ProviderOptions>)
  const preserved = getRuntimeApiKeyProviders().filter((provider) => LLM_PROVIDERS.some((definition) => definition.id === provider.id))
  const merged = [...preserved]
  for (const provider of apiKeyProviders) {
    if (merged.some((item) => item.id === provider.id)) continue
    merged.push(provider)
  }
  setRuntimeApiKeyProviders(merged)
  await ensureDefaultModel(merged).catch(() => {})
}

export const autoloadLlmProviders = async (): Promise<void> => {
  const collected: Array<ProviderOptions> = []
  for (const definition of LLM_PROVIDERS) {
    const provider = await loadProviderFromDefinition(definition).catch(() => undefined)
    if (provider && !collected.some((item) => item.id === provider.id)) collected.push(provider)
  }
  const apiKeyProviders = await loadApiKeyProviders().catch(() => [] as Array<ProviderOptions>)
  for (const provider of apiKeyProviders) {
    if (collected.some((item) => item.id === provider.id)) continue
    collected.push(provider)
  }
  setRuntimeApiKeyProviders(collected)
  await ensureDefaultModel(collected).catch(() => {})
}
