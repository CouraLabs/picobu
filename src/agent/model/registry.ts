import { hyper } from '@agent/model/catalog-hyper.ts'
import { fetchModelsDevProvider, listAllModelsDevProviders, modelsFromModelsDev } from '@agent/model/catalog-models-dev.ts'
import { fetchModels } from '@agent/model/fetch-models.ts'
import { LOCAL_PRESET_PROBE_TIMEOUT_MS, LOCAL_PROVIDER_PRESETS, localPresetApiKey, localPresetBaseUrl, modelsUrlForBaseUrl } from '@agent/model/local-presets.ts'
import { indexCatalogModelStatuses } from '@agent/model/model-availability.ts'
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

const SKIPPED_AUTOLOAD_PROVIDER_IDS: ReadonlySet<string> = new Set(['github-copilot'])

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
    models = await fetchModels(definition.modelsUrl, apiKey, { id: definition.id, baseUrl: definition.baseUrl })
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

export const loadApiKeyProviders = async (devProviders: Array<ModelsDevProvider>): Promise<Array<ProviderOptions>> => {
  const configured = new Set(options.providers.map((provider) => provider.id))
  const runtime: Array<ProviderOptions> = []
  for (const dev of devProviders) {
    if (!dev || typeof dev.id !== 'string') continue
    if (!Array.isArray(dev.env) || dev.env.length === 0) continue
    if (SKIPPED_AUTOLOAD_PROVIDER_IDS.has(dev.id)) continue
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

export const loadLocalPresetProviders = async (): Promise<Array<ProviderOptions>> => {
  const configured = new Set(options.providers.map((provider) => provider.id))
  const probed = await Promise.all(
    LOCAL_PROVIDER_PRESETS.map(async (preset): Promise<ProviderOptions | undefined> => {
      if (configured.has(preset.id)) return undefined
      const baseUrl = localPresetBaseUrl(preset)
      const apiKey = localPresetApiKey(preset)
      let models: Array<ProviderModelOptions> = []
      try {
        models = await fetchModels(modelsUrlForBaseUrl(baseUrl), apiKey, { id: preset.id, baseUrl }, { timeoutMs: LOCAL_PRESET_PROBE_TIMEOUT_MS })
      } catch {
        models = []
      }
      if (models.length === 0) return undefined
      return { id: preset.id, name: preset.name, type: preset.type, baseUrl, ...(apiKey ? { apiKey } : {}), npm: preset.npm, models }
    }),
  )
  return probed.flatMap((provider) => (provider ? [provider] : []))
}

const loadCatalogModelStatuses = async (): Promise<Array<ModelsDevProvider>> => {
  const devProviders = await listAllModelsDevProviders().catch(() => [] as Array<ModelsDevProvider>)
  indexCatalogModelStatuses(devProviders)
  return devProviders
}

export const autoloadApiKeyProviders = async (): Promise<void> => {
  const devProviders = await loadCatalogModelStatuses()
  const apiKeyProviders = await loadApiKeyProviders(devProviders).catch(() => [] as Array<ProviderOptions>)
  const preserved = getRuntimeApiKeyProviders().filter((provider) => LLM_PROVIDERS.some((definition) => definition.id === provider.id))
  const localProviders = await loadLocalPresetProviders().catch(() => [] as Array<ProviderOptions>)
  const merged = [...preserved]
  for (const provider of [...apiKeyProviders, ...localProviders]) {
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
  await backfillStatusLine().catch(() => {})
  const devProviders = await loadCatalogModelStatuses()
  const apiKeyProviders = await loadApiKeyProviders(devProviders).catch(() => [] as Array<ProviderOptions>)
  const localProviders = await loadLocalPresetProviders().catch(() => [] as Array<ProviderOptions>)
  for (const provider of [...apiKeyProviders, ...localProviders]) {
    if (collected.some((item) => item.id === provider.id)) continue
    collected.push(provider)
  }
  setRuntimeApiKeyProviders(collected)
  await ensureDefaultModel(collected).catch(() => {})
}

const backfillStatusLine = async (): Promise<void> => {
  const missing = LLM_PROVIDERS.filter((definition) => (definition.statusLine?.items?.length ?? 0) > 0 && !options.statusLine.some((entry) => entry.provider === definition.id))
  if (missing.length === 0) return
  const statusLine = [...options.statusLine, ...missing.flatMap((definition) => (definition.statusLine?.items ? [{ provider: definition.id, items: definition.statusLine.items }] : []))]
  const next = await updateSettings({ statusLine })
  options.statusLine = next.statusLine
}
