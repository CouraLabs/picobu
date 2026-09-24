import type { ProviderModelOptions } from '@config/options.ts'
import { z } from 'zod'

const CopilotVisionLimitsSchema = z.object({
  max_prompt_image_size: z.number(),
  max_prompt_images: z.number(),
  supported_media_types: z.array(z.string()),
})

const CopilotLimitsSchema = z.object({
  max_context_window_tokens: z.number().optional(),
  max_output_tokens: z.number().optional(),
  max_prompt_tokens: z.number().optional(),
  vision: CopilotVisionLimitsSchema.optional(),
})

const CopilotSupportsSchema = z.object({
  adaptive_thinking: z.boolean().optional(),
  max_thinking_budget: z.number().optional(),
  min_thinking_budget: z.number().optional(),
  reasoning_effort: z.array(z.string()).optional(),
  streaming: z.boolean().optional(),
  structured_outputs: z.boolean().optional(),
  tool_calls: z.boolean().optional(),
  vision: z.boolean().optional(),
})

const CopilotCapabilitiesSchema = z.object({
  family: z.string().optional(),
  limits: CopilotLimitsSchema.optional(),
  supports: CopilotSupportsSchema,
})

const CopilotBillingSchema = z.object({
  token_prices: z
    .object({
      batch_size: z.number(),
      default: z.object({
        cache_price: z.number(),
        input_price: z.number(),
        output_price: z.number(),
      }),
    })
    .optional(),
})

const CopilotPolicySchema = z.object({
  state: z.string().optional(),
})

const CopilotItemSchema = z.object({
  model_picker_enabled: z.boolean().optional(),
  id: z.string(),
  name: z.string().optional(),
  version: z.string().optional(),
  supported_endpoints: z.array(z.string()).optional(),
  policy: CopilotPolicySchema.optional(),
  billing: CopilotBillingSchema.optional(),
  capabilities: CopilotCapabilitiesSchema,
})

const CopilotModelsResponseSchema = z.object({
  data: z.array(z.unknown()),
})

export type CopilotRemoteItem = z.infer<typeof CopilotItemSchema>

export interface CopilotCatalog {
  usable: Array<CopilotRemoteItem>
  pickerEnabled: Set<string>
  selectedIds: Array<string>
}

const isUsable = (item: CopilotRemoteItem): boolean => {
  if (item.policy?.state === 'disabled') return false
  if (typeof item.capabilities.limits?.max_output_tokens !== 'number') return false
  if (typeof item.capabilities.limits?.max_prompt_tokens !== 'number') return false
  if (item.capabilities.supports.tool_calls !== true) return false
  return true
}

export const parseCopilotCatalog = (raw: unknown, allowPolicyFallback: boolean): CopilotCatalog => {
  const parsed = CopilotModelsResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error('Invalid Copilot models response')
  const usable = parsed.data.data.flatMap((entry) => {
    const item = CopilotItemSchema.safeParse(entry)
    if (!item.success) return []
    if (!isUsable(item.data)) return []
    return [item.data]
  })
  const picker = usable.filter((item) => item.model_picker_enabled === true).map((item) => item.id)
  const selected = picker.length > 0 ? picker : allowPolicyFallback ? usable.map((item) => item.id) : []
  return { usable, pickerEnabled: new Set(selected), selectedIds: selected }
}

export const parseCopilotModelIds = (raw: unknown, allowPolicyFallback: boolean): Array<string> => parseCopilotCatalog(raw, allowPolicyFallback).selectedIds

const normalizedEndpoints = (item: CopilotRemoteItem): Array<string> => (item.supported_endpoints ?? []).map((endpoint) => endpoint.toLowerCase())

const hasMessagesEndpoint = (item: CopilotRemoteItem): boolean => normalizedEndpoints(item).some((endpoint) => endpoint.includes('messages'))

const hasResponsesEndpoint = (item: CopilotRemoteItem): boolean => normalizedEndpoints(item).some((endpoint) => endpoint.includes('responses'))

export const copilotModelNpm = (item: CopilotRemoteItem): string => {
  if (hasMessagesEndpoint(item)) return '@ai-sdk/anthropic'
  return '@ai-sdk/github-copilot'
}

export const copilotModelEndpoint = (item: CopilotRemoteItem): 'chat' | 'responses' | 'messages' => {
  if (hasMessagesEndpoint(item)) return 'messages'
  const match = /^gpt-(\d+)/.exec(item.id)
  const major = match ? Number(match[1]) : Number.NaN
  const isGpt5OrNewer = Number.isFinite(major) && major >= 5 && !item.id.startsWith('gpt-5-mini')
  return isGpt5OrNewer && hasResponsesEndpoint(item) ? 'responses' : 'chat'
}

export const buildCopilotProviderModel = (remote: CopilotRemoteItem, prev?: ProviderModelOptions): ProviderModelOptions => {
  const supports = remote.capabilities.supports
  const limits = remote.capabilities.limits
  const efforts = (supports.reasoning_effort ?? []).filter((effort) => effort.length > 0)
  const derivedReasoning = Boolean(supports.adaptive_thinking) || efforts.length > 0 || supports.max_thinking_budget !== undefined || supports.min_thinking_budget !== undefined
  const visionMedia = limits?.vision?.supported_media_types ?? []
  const hasVision = supports.vision === true || visionMedia.some((media) => media.startsWith('image/'))
  const modelSupports: Array<string> = hasVision ? ['text', 'vision'] : ['text']
  const prices = remote.billing?.token_prices
  const usdPerMillion = prices && prices.batch_size > 0 ? 10000 / prices.batch_size : 0
  const liveBilling =
    prices === undefined
      ? undefined
      : {
          input: prices.default.input_price * usdPerMillion,
          output: prices.default.output_price * usdPerMillion,
          cacheRead: prices.default.cache_price * usdPerMillion,
          cacheWrite: 0,
        }
  const liveEfforts = efforts.length > 0 ? efforts : supports.max_thinking_budget !== undefined ? ['max', 'high'] : undefined
  return {
    id: remote.id,
    name: prev?.name ?? remote.name ?? remote.id,
    description: prev?.description,
    context: limits?.max_context_window_tokens ?? limits?.max_prompt_tokens ?? prev?.context ?? 0,
    output: limits?.max_output_tokens ?? prev?.output ?? 0,
    reasoning: prev?.reasoning ?? (derivedReasoning ? true : undefined),
    supports: modelSupports,
    efforts: liveEfforts ?? prev?.efforts,
    defaultEffort: prev?.defaultEffort,
    billing: liveBilling ?? prev?.billing,
    npm: copilotModelNpm(remote),
    endpoint: copilotModelEndpoint(remote),
  }
}

export const buildCopilotModelsFromCatalog = (raw: unknown, allowPolicyFallback: boolean, existing?: Array<ProviderModelOptions>): Array<ProviderModelOptions> => {
  const catalog = parseCopilotCatalog(raw, allowPolicyFallback)
  const prevById = new Map((existing ?? []).map((model) => [model.id, model]))
  const remoteById = new Map(catalog.usable.map((item) => [item.id, item]))
  const selected = new Set(catalog.selectedIds)
  return [...remoteById.values()].filter((item) => selected.has(item.id)).map((item) => buildCopilotProviderModel(item, prevById.get(item.id)))
}

export const fetchCopilotModels = async (
  baseUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{
  models: Array<ProviderModelOptions>
  pickerEnabled: Set<string>
}> => {
  const timeout = AbortSignal.timeout(5000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers,
    signal: combined,
  })
  if (!response.ok) throw new Error(`Failed to fetch models: ${response.status}`)
  const raw = (await response.json()) as unknown
  const allowFallback = baseUrl === 'https://api.individual.githubcopilot.com'
  const catalog = parseCopilotCatalog(raw, allowFallback)
  const prevById = new Map<string, ProviderModelOptions>()
  const models = [...new Map(catalog.usable.map((item) => [item.id, item])).values()]
    .filter((item) => catalog.pickerEnabled.has(item.id))
    .map((item) => buildCopilotProviderModel(item, prevById.get(item.id)))
  return { models, pickerEnabled: catalog.pickerEnabled }
}
