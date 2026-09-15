import type { ProviderModelOptions, ProviderModelStatus, ProviderOptions } from '@config/options.ts'

export type ProviderRef = Pick<ProviderOptions, 'id'> & { baseUrl?: string }
export type ModelRef = Pick<ProviderModelOptions, 'id' | 'status' | 'billing'>

export interface CatalogStatusSource {
  id: string
  models?: Record<string, { id?: string | undefined; status?: string | undefined; cost?: { input?: number | undefined; output?: number | undefined } | undefined } | undefined>
}

interface CatalogModelInfo {
  status?: string | undefined
  input?: number | undefined
  output?: number | undefined
}

const catalogModels = new Map<string, CatalogModelInfo>()

export const indexCatalogModelStatuses = (providers: Array<CatalogStatusSource>): void => {
  for (const provider of providers) {
    for (const [key, model] of Object.entries(provider.models ?? {})) {
      if (!model) continue
      const info: CatalogModelInfo = {}
      if (typeof model.status === 'string' && model.status.length > 0) info.status = model.status
      if (typeof model.cost?.input === 'number') info.input = model.cost.input
      if (typeof model.cost?.output === 'number') info.output = model.cost.output
      if (info.status === undefined && info.input === undefined && info.output === undefined) continue
      catalogModels.set(`${provider.id}/${key}`, info)
      if (typeof model.id === 'string' && model.id.length > 0) catalogModels.set(`${provider.id}/${model.id}`, info)
    }
  }
}

export const clearCatalogModelStatuses = (): void => {
  catalogModels.clear()
}

export const catalogStatusFor = (providerId: string, modelId: string): string | undefined => catalogModels.get(`${providerId}/${modelId}`)?.status

export const catalogBillingFor = (providerId: string, modelId: string): { input?: number | undefined; output?: number | undefined } | undefined => {
  const info = catalogModels.get(`${providerId}/${modelId}`)
  if (info?.input === undefined && info?.output === undefined) return undefined
  return { input: info?.input, output: info?.output }
}

export const isExperimentalModelsEnabled = (): boolean => {
  const value = process.env.PICOBU_EXPERIMENTAL_MODELS?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

const ZEN_PROVIDER_IDS: ReadonlySet<string> = new Set(['opencode', 'opencode-go', 'opencode-zen'])

export const isZenProvider = (provider: ProviderRef): boolean => {
  if (ZEN_PROVIDER_IDS.has(provider.id)) return true
  const baseUrl = provider.baseUrl ?? ''
  return baseUrl.includes('/zen/go/') || baseUrl.includes('opencode.ai/zen')
}

export const isZenFullProvider = (provider: ProviderRef): boolean => {
  if (provider.id === 'opencode' || provider.id === 'opencode-zen') return true
  if (provider.id === 'opencode-go') return false
  const baseUrl = provider.baseUrl ?? ''
  if (baseUrl.includes('/zen/go/')) return false
  return baseUrl.includes('opencode.ai/zen')
}

const ZEN_HIDDEN_IDS: ReadonlySet<string> = new Set(['claude-3-5-haiku'])

export const isZenModelIdAvailable = (id: string): boolean => {
  if (id.startsWith('alpha-')) return false
  if (id.endsWith(':global')) return false
  if (ZEN_HIDDEN_IDS.has(id)) return false
  return true
}

export const isModelStatusAvailable = (status: ProviderModelStatus | undefined, experimental = isExperimentalModelsEnabled()): boolean => {
  if (status === 'deprecated') return false
  if (status === 'alpha' && !experimental) return false
  return true
}

export const isFreeModel = (providerId: string, model: ModelRef): boolean => {
  const billing = model.billing ?? catalogBillingFor(providerId, model.id)
  if (!billing) return false
  return (billing.input ?? 0) === 0 && (billing.output ?? 0) === 0
}

export const isModelAvailable = (provider: ProviderRef, model: ModelRef, experimental = isExperimentalModelsEnabled()): boolean => {
  const status = model.status ?? (catalogStatusFor(provider.id, model.id) as ProviderModelStatus | undefined)
  if (!isModelStatusAvailable(status, experimental)) return false
  if (isZenFullProvider(provider) && isFreeModel(provider.id, model)) return false
  if (isZenProvider(provider) && !isZenModelIdAvailable(model.id)) return false
  return true
}

export const filterAvailableModels = <TModel extends ModelRef>(provider: ProviderRef, models: Array<TModel>, experimental = isExperimentalModelsEnabled()): Array<TModel> =>
  models.filter((model) => isModelAvailable(provider, model, experimental))
