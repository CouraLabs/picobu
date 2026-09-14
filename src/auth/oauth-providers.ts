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

export const listOAuthProviderEntries = (): Array<ProviderOptions> => {
  const configured = new Set(options.providers.map((provider) => provider.id))
  return OAUTH_AUTHS.flatMap((auth) => {
    if (configured.has(auth.id)) return []
    const credential = getCredential(auth.id)
    const ids = credential?.availableModelIds
    if (!credential || !ids || ids.length === 0) return []
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
        models: bareModels(ids),
      } satisfies ProviderOptions,
    ]
  })
}

export const listProviders = (): Array<ProviderOptions> => [...options.providers, ...listOAuthProviderEntries()]
