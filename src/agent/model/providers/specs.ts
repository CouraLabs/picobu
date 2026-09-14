export interface ProviderSpec {
  id: string
  headers?: Record<string, string>
}

const PICOBU_REFERER = 'https://github.com/CouraLabs/picobu'
const PICOBU_TITLE = 'picobu'

export const anthropic: ProviderSpec = {
  id: 'anthropic',
  headers: {
    'anthropic-beta': 'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
  },
}

export const openai: ProviderSpec = {
  id: 'openai',
}

export const xai: ProviderSpec = {
  id: 'xai',
}

export const githubCopilot: ProviderSpec = {
  id: 'github-copilot',
  headers: {
    'X-GitHub-Api-Version': '2026-06-01',
  },
}

export const openrouter: ProviderSpec = {
  id: 'openrouter',
  headers: {
    'HTTP-Referer': PICOBU_REFERER,
    'X-Title': PICOBU_TITLE,
  },
}

export const llmgateway: ProviderSpec = {
  id: 'llmgateway',
  headers: {
    'HTTP-Referer': PICOBU_REFERER,
    'X-Title': PICOBU_TITLE,
    'X-Source': PICOBU_TITLE,
  },
}

export const vercel: ProviderSpec = {
  id: 'vercel',
  headers: {
    'http-referer': PICOBU_REFERER,
    'x-title': PICOBU_TITLE,
  },
}

export const kilo: ProviderSpec = {
  id: 'kilo',
  headers: {
    'HTTP-Referer': PICOBU_REFERER,
    'X-Title': PICOBU_TITLE,
  },
}

export const zenmux: ProviderSpec = {
  id: 'zenmux',
  headers: {
    'HTTP-Referer': PICOBU_REFERER,
    'X-Title': PICOBU_TITLE,
  },
}

export const nvidia: ProviderSpec = {
  id: 'nvidia',
  headers: {
    'HTTP-Referer': PICOBU_REFERER,
    'X-Title': PICOBU_TITLE,
    'X-BILLING-INVOKE-ORIGIN': 'picobu',
  },
}

export const cerebras: ProviderSpec = {
  id: 'cerebras',
  headers: {
    'X-Cerebras-3rd-Party-Integration': 'picobu',
  },
}

export const gitlab: ProviderSpec = {
  id: 'gitlab',
  headers: {
    'anthropic-beta': 'context-1m-2025-08-07',
  },
}

export const cloudflareWorkersAi: ProviderSpec = {
  id: 'cloudflare-workers-ai',
}

export const cloudflareAiGateway: ProviderSpec = {
  id: 'cloudflare-ai-gateway',
  headers: {
    'cf-aig-gateway-id': '',
  },
}

export const snowflakeCortex: ProviderSpec = {
  id: 'snowflake-cortex',
}

export const azure: ProviderSpec = {
  id: 'azure',
}

export const amazonBedrock: ProviderSpec = {
  id: 'amazon-bedrock',
}

export const googleVertex: ProviderSpec = {
  id: 'google-vertex',
}

export const kimiCoding: ProviderSpec = {
  id: 'kimi-coding',
}

export const openrouterOAuth: ProviderSpec = {
  id: 'openrouter',
}

export const radius: ProviderSpec = {
  id: 'radius',
}
