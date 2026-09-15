import { filterAvailableModels, isExperimentalModelsEnabled } from '@agent/model/model-availability.ts'
import type { ProviderModelOptions, ProviderModelReasoningEffort, ProviderModelStatus } from '@config/options.ts'
import { Models, type Model as ModelsDevModel, type Provider as ModelsDevProvider } from '@opencode-ai/models'

export const fetchModelsDevProvider = async (apiKeyEnv: string): Promise<ModelsDevProvider | undefined> => {
  try {
    const client = Models.make()
    const providers = await client.providers()
    const match = Object.values(providers).find((provider) => provider.env?.includes(apiKeyEnv) ?? false)
    if (match) return match as ModelsDevProvider
  } catch {}
  const snapshot = await import('@opencode-ai/models/snapshot')
  return Object.values(snapshot.providers).find((provider) => (provider as ModelsDevProvider).env?.includes(apiKeyEnv) ?? false) as ModelsDevProvider | undefined
}

export const fetchModelsDevProviderById = async (providerId: string): Promise<ModelsDevProvider | undefined> => {
  try {
    const client = Models.make()
    const providers = await client.providers()
    const match = (providers as Record<string, ModelsDevProvider>)[providerId]
    if (match) return match
  } catch {}
  const snapshot = await import('@opencode-ai/models/snapshot')
  return (snapshot.providers as Record<string, ModelsDevProvider>)[providerId]
}

export const listAllModelsDevProviders = async (): Promise<Array<ModelsDevProvider>> => {
  try {
    const client = Models.make()
    const providers = await client.providers()
    const values = Object.values(providers)
    if (values.length > 0) return values as Array<ModelsDevProvider>
  } catch {}
  const snapshot = await import('@opencode-ai/models/snapshot')
  return Object.values(snapshot.providers) as Array<ModelsDevProvider>
}

export const listApiKeyModelsDevProviders = async (): Promise<Array<ModelsDevProvider>> => {
  const all = await listAllModelsDevProviders()
  return all.filter((provider) => Array.isArray(provider.env) && provider.env.length > 0)
}

const modelsDevEfforts = (model: ModelsDevModel): Array<ProviderModelReasoningEffort> | undefined => {
  const values = (model.reasoning_options ?? []).flatMap((option) => (option.type === 'effort' ? option.values : []))
  const efforts = values.filter((value): value is Exclude<typeof value, null | undefined> => value !== null && value !== undefined)
  return efforts.length > 0 ? efforts : undefined
}

export const modelsFromModelsDev = (provider: ModelsDevProvider, opts?: { experimental?: boolean }): Array<ProviderModelOptions> => {
  const experimental = opts?.experimental ?? isExperimentalModelsEnabled()
  const baseUrl = typeof provider.api === 'string' ? provider.api : ''
  const models = Object.values(provider.models ?? {}).map((model) => {
    const supports = ['text']
    if (model.modalities?.input?.includes('image') ?? false) supports.push('vision')
    const npm = typeof model.provider?.npm === 'string' && model.provider.npm.length > 0 ? model.provider.npm : undefined
    return {
      id: model.id,
      name: model.name || model.id,
      description: model.description || undefined,
      context: model.limit?.context ?? 0,
      output: model.limit?.output ?? 0,
      reasoning: model.reasoning || undefined,
      supports,
      efforts: modelsDevEfforts(model),
      billing: model.cost
        ? {
            input: model.cost.input,
            output: model.cost.output,
            cacheRead: model.cost.cache_read,
            cacheWrite: model.cost.cache_write,
          }
        : undefined,
      ...(npm ? { npm } : {}),
      ...(model.status ? { status: model.status as ProviderModelStatus } : {}),
    } satisfies ProviderModelOptions
  })
  return filterAvailableModels({ id: provider.id, baseUrl }, models, experimental)
}
