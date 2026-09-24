import { z } from 'zod'

export type OpenAICompatibleChatModelId = string

export const openaiCompatibleProviderOptions = z.object({
  user: z.string().optional(),
  reasoningEffort: z.string().optional(),
  textVerbosity: z.string().optional(),
  thinking_budget: z.number().optional(),
})

export type OpenAICompatibleProviderOptions = z.infer<typeof openaiCompatibleProviderOptions>
