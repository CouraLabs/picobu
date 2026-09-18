import { headersForProviderId } from '@agent/model/providers/index.ts'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createCerebras } from '@ai-sdk/cerebras'
import { createCohere } from '@ai-sdk/cohere'
import { createDeepInfra } from '@ai-sdk/deepinfra'
import { createGateway } from '@ai-sdk/gateway'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createGroq } from '@ai-sdk/groq'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenResponses } from '@ai-sdk/open-responses'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createPerplexity } from '@ai-sdk/perplexity'
import { createTogetherAI } from '@ai-sdk/togetherai'
import { createVercel } from '@ai-sdk/vercel'
import { createXai } from '@ai-sdk/xai'
import { COPILOT_HEADERS } from '@auth/github-copilot.ts'
import { oauthAuthById } from '@auth/index.ts'
import { listProviders } from '@auth/oauth-providers.ts'
import { getCredential } from '@auth/store.ts'
import { options, type ProviderModelBilling, type ProviderModelCapability, type ProviderModelOptions, type ProviderOptions } from '@config/options.ts'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { initLockDir } from '@shared/lock.ts'
import { getVersion } from '@shared/version.ts'
import type { LanguageModel } from 'ai'

initLockDir(options.app.systemDir)

export interface ResolvedModel {
  provider: ProviderOptions
  modelId: string
  model: LanguageModel
  modelMeta: ProviderModelOptions
}

export const resolveApiKey = (apiKey?: string): string | undefined => {
  if (!apiKey) return undefined
  return apiKey.startsWith('env:') ? process.env[apiKey.slice(4)] : apiKey
}

const resolveProviderHeader = (providerId: string, key: string, value: string): string => {
  if (!value.startsWith('env:')) return value
  const name = value.slice(4)
  const resolved = process.env[name]
  if (resolved === undefined || resolved.length === 0) {
    throw new Error(`Provider "${providerId}" header "${key}" references unset environment variable "${name}"`)
  }
  return resolved
}

export const resolveAuth = (provider: ProviderOptions): { apiKey?: string; baseUrl?: string } => {
  const ref = provider.apiKey
  if (!ref?.startsWith('auth:')) return { apiKey: resolveApiKey(ref) }
  const id = ref.slice('auth:'.length)
  const credential = getCredential(id)
  if (!credential) {
    throw new Error(`No saved login for "${id}". Run /login ${id} to authenticate.`)
  }
  const auth = oauthAuthById(id)
  return auth ? auth.toAuth(credential) : { apiKey: credential.access }
}

export const npmForProviderType = (type: ProviderOptions['type']): string => {
  switch (type) {
    case 'openai':
      return '@ai-sdk/openai'
    case 'anthropic':
      return '@ai-sdk/anthropic'
    case 'openai-responses':
      return '@ai-sdk/openai'
    default:
      return '@ai-sdk/openai-compatible'
  }
}

export interface ModelInstanceOptions {
  modelNpm?: string
  sessionId?: string
}

const OPENCODE_GO_BASE_MARKER = '/zen/go/'
const OPENCODE_GO_FALLBACK_SESSION = 'picobu-shared'
const OPENCODE_GO_RESPONSES_MODELS: ReadonlySet<string> = new Set(['gpt-5.6-luna', 'grok-4.5', 'grok-4.6', 'muse-spark-1.2-contributor', 'muse-spark-1.3-contributor'])
const OPENCODE_GO_MESSAGES_PREFIXES: ReadonlyArray<string> = ['minimax', 'qwen']
const OPENCODE_GO_ENDPOINT_SUFFIXES: ReadonlyArray<string> = ['/chat/completions', '/responses', '/messages']

export const isOpencodeGoProvider = (provider: ProviderOptions): boolean => provider.id === 'opencode-go' || provider.baseUrl.includes(OPENCODE_GO_BASE_MARKER)

export const opencodeGoBaseUrl = (baseUrl: string | undefined): string | undefined => {
  if (!baseUrl?.includes(OPENCODE_GO_BASE_MARKER)) return baseUrl
  const trimmed = baseUrl.replace(/\/$/, '')
  const suffix = OPENCODE_GO_ENDPOINT_SUFFIXES.find((ending) => trimmed.endsWith(ending))
  return suffix ? trimmed.slice(0, -suffix.length) : baseUrl
}

export const npmForModel = (provider: ProviderOptions, modelMeta?: Pick<ProviderModelOptions, 'id' | 'npm'>): string => {
  if (modelMeta?.npm && modelMeta.npm.length > 0) return modelMeta.npm
  if (isOpencodeGoProvider(provider) && modelMeta) {
    if (OPENCODE_GO_RESPONSES_MODELS.has(modelMeta.id)) return '@ai-sdk/openai'
    const lowered = modelMeta.id.toLowerCase()
    if (OPENCODE_GO_MESSAGES_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return '@ai-sdk/anthropic'
  }
  return provider.npm ?? npmForProviderType(provider.type)
}

export const createModelInstance = (provider: ProviderOptions, modelId: string, opts?: ModelInstanceOptions) => {
  const auth = resolveAuth(provider)
  const apiKey = auth.apiKey
  const npm = npmForModel(provider, { id: modelId, ...(opts?.modelNpm ? { npm: opts.modelNpm } : {}) })
  const rawBaseUrl = auth.baseUrl ?? (provider.baseUrl || undefined)
  const goBaseUrl = isOpencodeGoProvider(provider) && provider.type !== 'openai-responses' ? opencodeGoBaseUrl(rawBaseUrl) : rawBaseUrl
  const baseUrl = provider.id === 'github-copilot' && npm === '@ai-sdk/anthropic' && goBaseUrl && !goBaseUrl.replace(/\/$/, '').endsWith('/v1') ? `${goBaseUrl.replace(/\/$/, '')}/v1` : goBaseUrl
  const headers = headersForProvider(provider, opts?.sessionId ? { sessionId: opts.sessionId } : undefined)
  switch (npm) {
    case '@ai-sdk/anthropic':
      return createAnthropic({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/openai':
      if (provider.type === 'openai-responses') return createOpenResponses({ url: baseUrl ?? '', name: provider.name, apiKey, headers })(modelId)
      if (isOpencodeGoProvider(provider)) return createOpenAI({ baseURL: baseUrl, apiKey, headers }).responses(modelId)
      return createOpenAI({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/google':
      return createGoogleGenerativeAI({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/google-vertex':
      return createVertex({ baseURL: baseUrl, headers } as never)(modelId)
    case '@ai-sdk/azure':
      return createAzure({ baseURL: baseUrl, apiKey, headers } as never)(modelId)
    case '@ai-sdk/amazon-bedrock':
      return createAmazonBedrock({ baseURL: baseUrl, headers } as never)(modelId)
    case '@ai-sdk/mistral':
      return createMistral({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/groq':
      return createGroq({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/deepinfra':
      return createDeepInfra({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/cerebras':
      return createCerebras({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/cohere':
      return createCohere({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/gateway':
      return createGateway({ baseURL: baseUrl, apiKey, headers } as never)(modelId)
    case '@ai-sdk/togetherai':
      return createTogetherAI({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/perplexity':
      return createPerplexity({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@ai-sdk/vercel':
      return createVercel({ baseURL: baseUrl, apiKey, headers } as never)(modelId)
    case '@ai-sdk/xai':
      return createXai({ baseURL: baseUrl, apiKey, headers })(modelId)
    case '@openrouter/ai-sdk-provider':
      return createOpenRouter({ baseURL: baseUrl, apiKey, headers })(modelId)
    default:
      break
  }
  switch (provider.type) {
    case 'openai':
      return createOpenAI({ baseURL: baseUrl, apiKey, headers })(modelId)
    case 'anthropic':
      return createAnthropic({ baseURL: baseUrl, apiKey, headers })(modelId)
    case 'openai-compatible':
      return createOpenAICompatible({ baseURL: baseUrl ?? '', name: provider.name, apiKey, headers })(modelId)
    case 'openai-responses':
      return createOpenResponses({ url: baseUrl ?? '', name: provider.name, apiKey, headers })(modelId)
    default:
      return createOpenAICompatible({ baseURL: baseUrl ?? '', name: provider.name, apiKey, headers })(modelId)
  }
}

export const headersForProvider = (provider: ProviderOptions, opts?: { sessionId?: string }): Record<string, string> | undefined => {
  const base = headersForProviderId(provider.id, provider.headers)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(base ?? {})) {
    headers[key] = resolveProviderHeader(provider.id, key, value)
  }
  if (provider.id === 'github-copilot') return { ...COPILOT_HEADERS, ...headers }
  if (isOpencodeGoProvider(provider)) {
    if (!headers['User-Agent']) headers['User-Agent'] = `picobu/${getVersion()}`
    const sessionId = opts?.sessionId?.trim() || headers['x-opencode-session']?.trim() || OPENCODE_GO_FALLBACK_SESSION
    headers['x-opencode-session'] = sessionId
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

export const resolveModelRef = (modelKey?: string): Omit<ResolvedModel, 'model'> => {
  const providers = listProviders()
  const target = modelKey ?? options.harness?.defaultModel
  if (!target) {
    const selectedProvider = providers[0]
    if (!selectedProvider) {
      throw new Error('No AI provider configured in options (see ~/.picobu/options.json)')
    }
    const modelId = selectedProvider.models[0]?.id
    if (!modelId) {
      throw new Error(`No model available for provider "${selectedProvider.id}"`)
    }
    const modelMeta = selectedProvider.models.find((m) => m.id === modelId)
    if (!modelMeta) {
      throw new Error(`No model metadata found for provider "${selectedProvider.id}" model "${modelId}"`)
    }
    return { provider: selectedProvider, modelId, modelMeta }
  }
  const slash = target.indexOf('/')
  if (slash <= 0) {
    const provider = providers.find((p) => p.id === target)
    if (!provider) {
      throw new Error(`Unknown provider "${target}". Known providers: ${providers.map((p) => p.id).join(', ') || 'none'}`)
    }
    const modelId = provider.models[0]?.id
    if (!modelId) {
      throw new Error(`No model available for provider "${provider.id}"`)
    }
    const modelMeta = provider.models.find((m) => m.id === modelId)
    if (!modelMeta) {
      throw new Error(`No model metadata found for provider "${provider.id}" model "${modelId}"`)
    }
    return { provider, modelId, modelMeta }
  }
  const targetProviderId = target.slice(0, slash)
  const targetModelId = target.slice(slash + 1)
  const provider = providers.find((p) => p.id === targetProviderId)
  if (!provider) {
    throw new Error(`Unknown provider "${targetProviderId}". Known providers: ${providers.map((p) => p.id).join(', ') || 'none'}`)
  }
  if (!targetModelId) {
    throw new Error(`Unknown model "${target}". Expected "<providerId>/<modelId>"`)
  }
  const modelMeta = provider.models.find((m) => m.id === targetModelId)
  if (!modelMeta) {
    throw new Error(`Unknown model "${targetModelId}" for provider "${targetProviderId}". Known models: ${provider.models.map((m) => m.id).join(', ') || 'none'}`)
  }
  return { provider, modelId: targetModelId, modelMeta }
}

export const resolveModel = (modelKey?: string, opts?: { sessionId?: string }): ResolvedModel => {
  const ref = resolveModelRef(modelKey)
  return { ...ref, model: createModelInstance(ref.provider, ref.modelId, { modelNpm: ref.modelMeta.npm, ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}) }) }
}

export const resolveDefaultModel = (): ResolvedModel => resolveModel(options.harness?.defaultModel)

export const resolveDefaultModelKey = (): string => {
  const ref = resolveModelRef(options.harness?.defaultModel)
  return `${ref.provider.id}/${ref.modelId}`
}

export interface ModelEntry {
  key: string
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  supports: Array<ProviderModelCapability>
  context: number
  output: number
  billing?: ProviderModelBilling
}

export function listModels(): Array<ModelEntry> {
  return listProviders().flatMap((p) =>
    p.models.map((m) => ({
      key: `${p.id}/${m.id}`,
      providerId: p.id,
      providerName: p.name,
      modelId: m.id,
      modelName: m.name ?? m.id,
      supports: m.supports ?? [],
      context: m.context,
      output: m.output,
      billing: m.billing,
    })),
  )
}
