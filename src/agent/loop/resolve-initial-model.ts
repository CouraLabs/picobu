import { resolveModel } from '@agent/model/resolver.ts'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export const resolveInitialModel = (modelKey: string, opts?: { sessionId?: string }): LanguageModel => {
  try {
    return resolveModel(modelKey, opts).model
  } catch (error) {
    console.error(`picobu: initial model resolution failed: ${error instanceof Error ? error.message : String(error)}`)
    return createOpenAICompatible({ name: 'unconfigured', apiKey: 'pending', baseURL: 'https://api.openai.com/v1' })('no-model')
  }
}
