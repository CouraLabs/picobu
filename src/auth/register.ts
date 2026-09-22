import { fetchModelsDevProvider, fetchModelsDevProviderById, modelsFromModelsDev } from '@agent/model/catalog-models-dev.ts'
import { getRuntimeApiKeyProviders } from '@agent/model/runtime-providers.ts'
import { DIGITALOCEAN_INFERENCE_BASE_URL } from '@auth/digitalocean.ts'
import { KIMI_CODING_BASE_URL } from '@auth/kimi-coding.ts'
import { type BuiltOAuthModels, buildOAuthModels, fetchLiveOAuthModelIds, oauthProviderHasLiveModels, selectModelsByIds } from '@auth/oauth-models.ts'
import { removeCredential, setCredential } from '@auth/store.ts'
import type { OAuthAuth, OAuthCredential } from '@auth/types.ts'
import { type HarnessOptions, type HarnessOptionsInput, options, type ProviderModelOptions, type ProviderOptions, updateSettings } from '@config/options.ts'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'

interface ProviderMeta {
  type: 'openai' | 'anthropic' | 'openai-compatible'
  baseUrl?: string
  catalogEnv?: string
  catalogId?: string
  npm?: string
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    catalogEnv: 'OPENAI_API_KEY',
    catalogId: 'openai',
    npm: '@ai-sdk/openai',
  },
  anthropic: {
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    catalogEnv: 'ANTHROPIC_API_KEY',
    catalogId: 'anthropic',
    npm: '@ai-sdk/anthropic',
  },
  'github-copilot': {
    type: 'openai-compatible',
    catalogEnv: 'GITHUB_TOKEN',
    catalogId: 'github-copilot',
    npm: '@ai-sdk/openai-compatible',
  },
  xai: {
    type: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    catalogEnv: 'XAI_API_KEY',
    catalogId: 'xai',
    npm: '@ai-sdk/xai',
  },
  openrouter: {
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    catalogEnv: 'OPENROUTER_API_KEY',
    catalogId: 'openrouter',
    npm: '@openrouter/ai-sdk-provider',
  },
  'kimi-coding': {
    type: 'openai-compatible',
    baseUrl: KIMI_CODING_BASE_URL,
    npm: '@ai-sdk/openai-compatible',
  },
  digitalocean: {
    type: 'openai-compatible',
    baseUrl: DIGITALOCEAN_INFERENCE_BASE_URL,
    catalogEnv: 'DIGITALOCEAN_ACCESS_TOKEN',
    catalogId: 'digitalocean',
    npm: '@ai-sdk/openai-compatible',
  },
  'snowflake-cortex': {
    type: 'openai-compatible',
    catalogId: 'snowflake-cortex',
    npm: '@ai-sdk/openai-compatible',
  },
  azure: { type: 'openai-compatible', npm: '@ai-sdk/azure' },
}

export const oauthProviderType = (id: string): ProviderOptions['type'] | undefined => PROVIDER_META[id]?.type
export const oauthProviderNpm = (id: string): string | undefined => PROVIDER_META[id]?.npm
export const selectCopilotModels = (catalog: ModelsDevProvider, availableModelIds: Array<string> | undefined): Array<ProviderModelOptions> => {
  if (availableModelIds === undefined) return modelsFromModelsDev(catalog)
  return selectModelsByIds(catalog, availableModelIds)
}
export { selectModelsByIds }

export interface CatalogSource {
  catalogId?: string
  catalogEnv?: string
}
const catalogLoaderFor = (meta: CatalogSource | undefined): Promise<ModelsDevProvider | undefined> => {
  if (meta?.catalogId) return fetchModelsDevProviderById(meta.catalogId).catch(() => undefined)
  if (meta?.catalogEnv) return fetchModelsDevProvider(meta.catalogEnv).catch(() => undefined)
  return Promise.resolve(undefined)
}
export const oauthProviderCatalogSupported = (id: string): boolean => {
  if (oauthProviderHasLiveModels(id)) return true
  const meta = PROVIDER_META[id]
  return Boolean(meta?.catalogId || meta?.catalogEnv)
}
export interface BuiltOAuthCredential extends BuiltOAuthModels {
  credential: OAuthCredential
}
export interface PopulateOAuthModelsOptions {
  signal?: AbortSignal
  loadCatalog?: (meta: CatalogSource) => Promise<ModelsDevProvider | undefined>
}
export const populateOAuthModels = async (auth: OAuthAuth, credential: OAuthCredential, opts?: PopulateOAuthModelsOptions): Promise<BuiltOAuthCredential> => {
  const meta = PROVIDER_META[auth.id]
  let liveIds: Array<string> = []
  try {
    liveIds = await fetchLiveOAuthModelIds(auth.id, credential.access, opts?.signal)
  } catch {
    liveIds = []
  }
  const storedModels = credential.availableModels
  if (liveIds.length === 0 && storedModels !== undefined && storedModels.length > 0)
    return { credential, modelIds: credential.availableModelIds ?? storedModels.map((model) => model.id), models: storedModels }
  const catalog = await (opts?.loadCatalog ?? catalogLoaderFor)({ ...(meta?.catalogId ? { catalogId: meta.catalogId } : {}), ...(meta?.catalogEnv ? { catalogEnv: meta.catalogEnv } : {}) })
  const ids = liveIds.length > 0 ? liveIds : (credential.availableModelIds ?? [])
  const built = buildOAuthModels(auth.id, ids, catalog)
  if (built.modelIds.length === 0) return { credential, modelIds: [], models: [] }
  const next: OAuthCredential = { ...credential, availableModelIds: built.modelIds, availableModels: built.models }
  await setCredential(auth.id, next)
  return { credential: next, modelIds: built.modelIds, models: built.models }
}
export const pickDefaultModel = (models: Array<ProviderModelOptions>): string | undefined => (models.find((m) => m.reasoning === true) ?? models[0])?.id
export const registerOAuthProvider = async (auth: OAuthAuth, credential: OAuthCredential): Promise<void> => {
  const meta = PROVIDER_META[auth.id]
  if (!meta) throw new Error(`No registration metadata for OAuth provider "${auth.id}"`)
  await setCredential(auth.id, credential)
  const populated = await populateOAuthModels(auth, credential)
  if (populated.modelIds.length === 0) throw new Error(`Could not load ${auth.name} models from the models.dev catalog`)
  if (options.harness?.defaultModel) return
  const defaultModelKey = `${auth.id}/${pickDefaultModel(populated.models)}`
  const next = await updateSettings({
    harness: { ...options.harness, defaultModel: defaultModelKey },
  })
  options.harness = next.harness
}
export const fixHarnessAfterLogout = (harness: HarnessOptions | undefined, providerId: string, providers: Array<ProviderOptions>): HarnessOptionsInput => {
  const first = providers[0]
  const firstModel = first ? (pickDefaultModel(first.models) ?? first.models[0]?.id) : undefined
  const fallback = first && firstModel ? `${first.id}/${firstModel}` : undefined
  const repoint = (selector?: string): string | undefined => (selector?.startsWith(`${providerId}/`) ? fallback : selector)
  return {
    ...(harness ?? {}),
    defaultModel: repoint(harness?.defaultModel),
    modelRoles: {
      ...(harness?.modelRoles ?? {}),
      tiny: repoint(harness?.modelRoles?.tiny),
      flash: repoint(harness?.modelRoles?.flash),
      heavy: repoint(harness?.modelRoles?.heavy),
    },
  }
}
export const repointModelKey = (modelKey: string, removedProviderId: string, providers: Array<ProviderOptions>): string => {
  if (!modelKey.startsWith(`${removedProviderId}/`)) return modelKey
  const first = providers[0]
  const model = first ? (pickDefaultModel(first.models) ?? first.models[0]?.id) : undefined
  return first && model ? `${first.id}/${model}` : modelKey
}
export const logoutOAuthProvider = async (id: string, currentModelKey: string): Promise<{ removed: boolean; nextModelKey: string }> => {
  const removedCredential = await removeCredential(id)
  const runtime = getRuntimeApiKeyProviders().filter((provider) => provider.id !== id && !options.providers.some((configured) => configured.id === provider.id))
  const fallbackProviders = [...options.providers.filter((provider) => provider.apiKey !== `auth:${id}`), ...runtime]
  const harness = fixHarnessAfterLogout(options.harness, id, fallbackProviders)
  const changed = JSON.stringify(harness) !== JSON.stringify(options.harness)
  if (changed) {
    const next = await updateSettings({ harness })
    if (next.harness) options.harness = next.harness
  }
  return {
    removed: removedCredential || changed,
    nextModelKey: repointModelKey(currentModelKey, id, fallbackProviders.length > 0 ? fallbackProviders : options.providers),
  }
}
