import type { LlmProviderDefinition } from '@agent/model/types.ts'

export const hyper: LlmProviderDefinition = {
  id: 'hyper',
  name: 'Charm Hyper',
  type: 'openai-compatible',
  baseUrl: 'https://hyper.charm.land/v1',
  modelsUrl: 'https://hyper.charm.land/v1/models',
  apiKeyEnv: 'HYPER_API_KEY',
  statusLine: {
    items: [
      { type: 'header', label: 'Rate Day', value: 'x-ratelimit-remaining-day' },
      { type: 'header', label: 'Rate Hour', value: 'x-ratelimit-remaining-hour' },
      { type: 'step-raw', label: 'Run HyperCredits', value: 'cost.hypercredits' },
      { type: 'endpoint', label: 'HyperCredits', endpoint: '/credits', value: 'balance' },
    ],
  },
}
