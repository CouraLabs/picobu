import { fetchModelsDevProvider, fetchModelsDevProviderById, modelsFromModelsDev } from '@agent/model/catalog-models-dev.ts'
import { getRuntimeApiKeyProviders } from '@agent/model/runtime-providers.ts'
import { DIGITALOCEAN_INFERENCE_BASE_URL } from '@auth/digitalocean.ts'
import { KIMI_CODING_BASE_URL } from '@auth/kimi-coding.ts'
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
export const selectModelsByIds = (catalog: ModelsDevProvider, availableModelIds: Array<string> | undefined): Array<ProviderModelOptions> => {
  if (availableModelIds === undefined) return modelsFromModelsDev(catalog)
  const ids = availableModelIds
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  const fromCatalog = modelsFromModelsDev(catalog).filter((m) => wanted.has(m.id))
  const extras = ids
    .filter((id) => !fromCatalog.some((m) => m.id === id))
    .map(
      (id): ProviderModelOptions => ({
        id,
        name: id,
        context: 0,
        output: 0,
        supports: ['text'],
      }),
    )
  return [...fromCatalog, ...extras]
}
const bareModels = (ids: Array<string>): Array<ProviderModelOptions> =>
  ids.map(
    (id): ProviderModelOptions => ({
      id,
      name: id,
      context: 0,
      output: 0,
      supports: ['text'],
    }),
  )
export const pickDefaultModel = (models: Array<ProviderModelOptions>): string | undefined => (models.find((m) => m.reasoning === true) ?? models[0])?.id
export const registerOAuthProvider = async (auth: OAuthAuth, credential: OAuthCredential): Promise<void> => {
  const meta = PROVIDER_META[auth.id]
  if (!meta) throw new Error(`No registration metadata for OAuth provider "${auth.id}"`)
  await setCredential(auth.id, credential)
  let modelsForDefault: Array<ProviderModelOptions> = credential.availableModels ?? []
  if (modelsForDefault.length === 0 && credential.availableModelIds !== undefined) {
    const catalog = meta.catalogId ? await fetchModelsDevProviderById(meta.catalogId) : meta.catalogEnv ? await fetchModelsDevProvider(meta.catalogEnv) : undefined
    if (catalog) modelsForDefault = selectModelsByIds(catalog, credential.availableModelIds)
    else if (credential.availableModelIds.length > 0) modelsForDefault = bareModels(credential.availableModelIds)
  }
  if (modelsForDefault.length === 0) {
    const catalog = meta.catalogId ? await fetchModelsDevProviderById(meta.catalogId).catch(() => undefined) : undefined
    if (catalog) modelsForDefault = modelsFromModelsDev(catalog)
  }
  if (modelsForDefault.length === 0) throw new Error(`Could not load ${auth.name} models from the models.dev catalog`)
  if (options.harness?.defaultModel) return
  const defaultModelKey = `${auth.id}/${pickDefaultModel(modelsForDefault)}`
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
