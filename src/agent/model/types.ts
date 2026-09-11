export interface LlmProviderDefinition {
  id: string
  name: string
  type: 'openai-compatible'
  baseUrl: string
  modelsUrl: string
  apiKeyEnv: string
}
