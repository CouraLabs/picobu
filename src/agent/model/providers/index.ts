import type { ProviderSpec } from '@agent/model/providers/specs.ts'
import {
  amazonBedrock,
  anthropic,
  azure,
  cerebras,
  cloudflareAiGateway,
  cloudflareWorkersAi,
  gitlab,
  googleVertex,
  kilo,
  kimiCoding,
  llmgateway,
  nvidia,
  openai,
  openrouter,
  radius,
  snowflakeCortex,
  vercel,
  xai,
  zenmux,
} from '@agent/model/providers/specs.ts'

const SPECS: Record<string, ProviderSpec> = {
  anthropic,
  openai,
  xai,
  openrouter,
  llmgateway,
  vercel,
  kilo,
  zenmux,
  nvidia,
  cerebras,
  gitlab,
  'cloudflare-workers-ai': cloudflareWorkersAi,
  'cloudflare-ai-gateway': cloudflareAiGateway,
  'snowflake-cortex': snowflakeCortex,
  azure,
  'amazon-bedrock': amazonBedrock,
  'google-vertex': googleVertex,
  'kimi-coding': kimiCoding,
  radius,
}

export const providerSpecFor = (id: string): ProviderSpec | undefined => SPECS[id]

export const headersForProviderId = (id: string, configured?: Record<string, string>): Record<string, string> | undefined => {
  const spec = providerSpecFor(id)
  const base = spec?.headers
  if (!base && !configured) return undefined
  if (!base) return configured
  if (!configured) return { ...base }
  return { ...base, ...configured }
}
