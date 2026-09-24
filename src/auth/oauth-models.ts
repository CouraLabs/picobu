import { modelsFromModelsDev } from '@agent/model/catalog-models-dev.ts'
import { isModelStatusAvailable } from '@agent/model/model-availability.ts'
import type { OAuthCredential } from '@auth/types.ts'
import type { ProviderModelOptions } from '@config/options.ts'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models'
export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models'
const LIVE_MODELS_TIMEOUT_MS = 10_000

export const OPENAI_OAUTH_ALLOWED_MODELS: ReadonlySet<string> = new Set(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark', 'gpt-6-sol', 'gpt-6-luna'])
export const OPENAI_OAUTH_DISALLOWED_MODELS: ReadonlySet<string> = new Set(['gpt-5.5-pro'])

export const isOpenAIOAuthModelId = (id: string): boolean => {
  if (OPENAI_OAUTH_ALLOWED_MODELS.has(id)) return true
  if (OPENAI_OAUTH_DISALLOWED_MODELS.has(id)) return false
  if (id === 'gpt-5.6') return false
  const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(id)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2] ?? 0)
  return major > 5 || (major === 5 && minor > 4)
}

export const filterOpenAIOAuthModelIds = (ids: Array<string>): Array<string> => {
  const kept = ids.filter(isOpenAIOAuthModelId)
  return kept.length > 0 ? kept : ids
}

export const OPENAI_OAUTH_CONTEXT_IDS: Array<string> = ['gpt-5.5', 'gpt-5.6']
export const OPENAI_OAUTH_LIMIT = { context: 400_000, output: 128_000 }

export const filterOpenAIOAuthModels = (models: Array<ProviderModelOptions>): Array<ProviderModelOptions> => {
  const kept = models.filter((model) => isOpenAIOAuthModelId(model.id))
  return kept.length > 0 ? kept : models
}

export const applyOpenAIOAuthOverrides = (models: Array<ProviderModelOptions>): Array<ProviderModelOptions> =>
  models.map((model) => ({
    ...model,
    billing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(OPENAI_OAUTH_CONTEXT_IDS.some((id) => model.id.includes(id)) ? OPENAI_OAUTH_LIMIT : {}),
  }))

export const bareOAuthModels = (ids: Array<string>): Array<ProviderModelOptions> =>
  ids.map(
    (id): ProviderModelOptions => ({
      id,
      name: id,
      context: 0,
      output: 0,
      supports: ['text'],
    }),
  )

export const selectModelsByIds = (catalog: ModelsDevProvider, availableModelIds: Array<string> | undefined): Array<ProviderModelOptions> => {
  if (availableModelIds === undefined) return modelsFromModelsDev(catalog)
  const ids = availableModelIds
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  const fromCatalog = modelsFromModelsDev(catalog).filter((model) => wanted.has(model.id))
  const blocked = new Set(
    Object.values(catalog.models ?? {})
      .filter((model) => !isModelStatusAvailable(model.status ?? undefined))
      .map((model) => model.id),
  )
  const extras = ids.filter((id) => !fromCatalog.some((model) => model.id === id) && !blocked.has(id)).map((id): ProviderModelOptions => ({ id, name: id, context: 0, output: 0, supports: ['text'] }))
  return [...fromCatalog, ...extras]
}

export interface BuiltOAuthModels {
  modelIds: Array<string>
  models: Array<ProviderModelOptions>
}

export const buildOAuthModels = (authId: string, liveIds: Array<string>, catalog: ModelsDevProvider | undefined): BuiltOAuthModels => {
  const live = authId === 'openai' ? filterOpenAIOAuthModelIds(liveIds) : liveIds
  let models: Array<ProviderModelOptions>
  if (live.length > 0) models = catalog ? selectModelsByIds(catalog, live) : bareOAuthModels(live)
  else if (catalog) models = selectModelsByIds(catalog, undefined)
  else models = []
  if (authId === 'openai') models = applyOpenAIOAuthOverrides(filterOpenAIOAuthModels(models))
  return { modelIds: models.map((model) => model.id), models }
}

export const oauthProviderHasLiveModels = (id: string): boolean => id === 'openai' || id === 'anthropic'

export const parseModelIdsPayload = (payload: unknown): Array<string> => {
  const data = (payload as { data?: unknown } | null | undefined)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const id = (entry as { id?: unknown } | null | undefined)?.id
    return typeof id === 'string' && id.length > 0 ? [id] : []
  })
}

export const fetchLiveOAuthModelIds = async (authId: string, access: string, signal?: AbortSignal): Promise<Array<string>> => {
  if (!oauthProviderHasLiveModels(authId)) return []
  const timeout = AbortSignal.timeout(LIVE_MODELS_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const headers: Record<string, string> = authId === 'openai' ? { Authorization: `Bearer ${access}` } : { 'x-api-key': access, 'anthropic-version': '2023-06-01' }
  const url = authId === 'openai' ? OPENAI_MODELS_URL : ANTHROPIC_MODELS_URL
  const response = await fetch(url, { headers, signal: combined })
  if (!response.ok) throw new Error(`models catalog request failed (${response.status} ${response.statusText})`)
  return parseModelIdsPayload(await response.json())
}

export const withPreservedModels = (next: OAuthCredential, prev: OAuthCredential): OAuthCredential => ({
  ...next,
  ...(prev.availableModelIds !== undefined ? { availableModelIds: prev.availableModelIds } : {}),
  ...(prev.availableModels !== undefined ? { availableModels: prev.availableModels } : {}),
})
