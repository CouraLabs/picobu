import type { ProviderStatusLine } from '@config/options.ts'

export interface LlmProviderDefinition {
  id: string
  name: string
  type: 'openai-compatible'
  baseUrl: string
  modelsUrl: string
  apiKeyEnv: string
  statusLine?: ProviderStatusLine
}
