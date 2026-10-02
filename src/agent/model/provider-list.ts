import { filterAvailableModels } from '@agent/model/model-availability.ts'
import { getRuntimeApiKeyProviders } from '@agent/model/runtime-providers.ts'
import { options, type ProviderOptions } from '@config/options.ts'

export const listProviders = (): Array<ProviderOptions> => {
  const configuredIds = new Set(options.providers.map((provider) => provider.id))
  const runtime = getRuntimeApiKeyProviders().filter((provider) => !configuredIds.has(provider.id))
  return [...options.providers, ...runtime].flatMap((provider) => {
    const models = filterAvailableModels(provider, provider.models)
    if (models.length === 0) return []
    return models.length === provider.models.length ? [provider] : [{ ...provider, models }]
  })
}
