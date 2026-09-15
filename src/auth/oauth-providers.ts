import { getRuntimeApiKeyProviders } from '@agent/model/runtime-providers.ts'
import { OAUTH_AUTHS } from '@auth/index.ts'
import { oauthProviderNpm, oauthProviderType } from '@auth/register.ts'
import { getCredential } from '@auth/store.ts'
import { options, type ProviderModelOptions, type ProviderOptions } from '@config/options.ts'

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

const liveModelsForCredential = (id: string): Array<ProviderModelOptions> | undefined => {
  const credential = getCredential(id)
  if (!credential) return undefined
  if (credential.availableModels && credential.availableModels.length > 0) return credential.availableModels
  if (credential.availableModelIds && credential.availableModelIds.length > 0) return bareModels(credential.availableModelIds)
  return undefined
}

export const listOAuthProviderEntries = (): Array<ProviderOptions> => {
  return OAUTH_AUTHS.flatMap((auth) => {
    const credential = getCredential(auth.id)
    if (!credential) return []
    const models = liveModelsForCredential(auth.id)
    if (!models || models.length === 0) return []
    const type = oauthProviderType(auth.id)
    if (!type) return []
    return [
      {
        id: auth.id,
        name: auth.name,
        type,
        baseUrl: auth.toAuth(credential).baseUrl ?? '',
        apiKey: `auth:${auth.id}`,
        npm: oauthProviderNpm(auth.id),
        models,
      } satisfies ProviderOptions,
    ]
  })
}

export const listProviders = (): Array<ProviderOptions> => {
  const configured = options.providers
  const configuredIds = new Set(configured.map((provider) => provider.id))
  const runtime = getRuntimeApiKeyProviders().filter((provider) => !configuredIds.has(provider.id))
  const live = listOAuthProviderEntries()
  const liveById = new Map(live.map((entry) => [entry.id, entry]))
  const mergedConfigured = configured.map((provider) => {
    const liveEntry = liveById.get(provider.id)
    if (!liveEntry) return provider
    return { ...provider, apiKey: liveEntry.apiKey, baseUrl: liveEntry.baseUrl || provider.baseUrl }
  })
  const mergedIds = new Set(mergedConfigured.map((provider) => provider.id))
  const extraRuntime = runtime.filter((provider) => !mergedIds.has(provider.id))
  const extraLive = live.filter((entry) => !mergedIds.has(entry.id))
  return [...mergedConfigured, ...extraRuntime, ...extraLive]
}
