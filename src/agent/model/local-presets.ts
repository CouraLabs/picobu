import type { ProviderOptions } from '@config/options.ts'

export interface LocalProviderPreset {
  id: string
  name: string
  type: ProviderOptions['type']
  npm: string
  defaultBaseUrl: string
  baseUrlEnv: string
  apiKeyEnv: string
}

export const LOCAL_PRESET_PROBE_TIMEOUT_MS = 1500

export const LOCAL_PROVIDER_PRESETS: Array<LocalProviderPreset> = [
  {
    id: 'litellm',
    name: 'LiteLLM',
    type: 'openai-compatible',
    npm: '@ai-sdk/openai-compatible',
    defaultBaseUrl: 'http://localhost:4000/v1',
    baseUrlEnv: 'LITELLM_BASE_URL',
    apiKeyEnv: 'LITELLM_API_KEY',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'openai-compatible',
    npm: '@ai-sdk/openai-compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    apiKeyEnv: 'OLLAMA_API_KEY',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai-compatible',
    npm: '@ai-sdk/openai-compatible',
    defaultBaseUrl: 'http://localhost:1234/v1',
    baseUrlEnv: 'LMSTUDIO_BASE_URL',
    apiKeyEnv: 'LMSTUDIO_API_KEY',
  },
]

export const localPresetBaseUrl = (preset: LocalProviderPreset): string => (process.env[preset.baseUrlEnv]?.trim() || preset.defaultBaseUrl).replace(/\/$/, '')

export const localPresetApiKey = (preset: LocalProviderPreset): string | undefined => process.env[preset.apiKeyEnv]?.trim() || undefined

export const modelsUrlForBaseUrl = (baseUrl: string): string => `${baseUrl.replace(/\/$/, '')}/models`
