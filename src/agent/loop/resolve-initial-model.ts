import { resolveModel } from '@agent/model/resolver.ts'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export const resolveInitialModel = (modelKey: string): LanguageModel => {
  try {
    return resolveModel(modelKey).model
  } catch (error) {
    console.error('picobu: initial model resolution failed:', error)
    return createOpenAICompatible({ name: 'unconfigured', apiKey: 'pending', baseURL: 'https://api.openai.com/v1' })('no-model')
  }
}
