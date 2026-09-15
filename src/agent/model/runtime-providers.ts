import type { ProviderOptions } from '@config/options.ts'

let apiKeyProviders: Array<ProviderOptions> = []

export const getRuntimeApiKeyProviders = (): Array<ProviderOptions> => [...apiKeyProviders]

export const setRuntimeApiKeyProviders = (providers: Array<ProviderOptions>): void => {
  apiKeyProviders = [...providers]
}

export const clearRuntimeApiKeyProviders = (): void => {
  apiKeyProviders = []
}
