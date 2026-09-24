import { createCopilotProvider } from '@agent/model/providers/copilot/copilot-provider.ts'
import type { ToolSet } from 'ai'

const PLACEHOLDER_BASE_URL = 'https://api.githubcopilot.com'

export const copilotProviderToolSet = (): ToolSet => {
  const provider = createCopilotProvider({ baseURL: PLACEHOLDER_BASE_URL, name: 'github-copilot' })
  return {
    web_search: provider.tools.webSearch(),
    code_interpreter: provider.tools.codeInterpreter(),
    image_generation: provider.tools.imageGeneration(),
    file_search: provider.tools.fileSearch({ vectorStoreIds: [] }),
  }
}
