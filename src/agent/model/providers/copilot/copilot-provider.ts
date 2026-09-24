import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { ProviderDefinedTool, ProviderExecutedTool } from '@ai-sdk/provider-utils'
import { type FetchFunction, withoutTrailingSlash, withUserAgentSuffix } from '@ai-sdk/provider-utils'
import { OpenAICompatibleChatLanguageModel } from './chat/openai-compatible-chat-language-model.ts'
import { OpenAIResponsesLanguageModel } from './responses/openai-responses-language-model.ts'
import { codeInterpreter } from './responses/tool/code-interpreter.ts'
import { fileSearch } from './responses/tool/file-search.ts'
import { imageGeneration } from './responses/tool/image-generation.ts'
import { webSearch } from './responses/tool/web-search.ts'

export interface CopilotProviderSettings {
  apiKey?: string
  baseURL: string
  headers?: Record<string, string>
  name?: string
  fetch?: FetchFunction
}

export interface CopilotProviderTools {
  webSearch: () => ProviderExecutedTool
  codeInterpreter: () => ProviderExecutedTool
  imageGeneration: () => ProviderExecutedTool
  fileSearch: (args: { vectorStoreIds: Array<string> }) => ProviderExecutedTool
}

export interface CopilotProvider {
  languageModel(modelId: string): LanguageModelV4
  chat(modelId: string): LanguageModelV4
  responses(modelId: string): LanguageModelV4
  tools: CopilotProviderTools
}

export function createCopilotProvider(settings: CopilotProviderSettings = { baseURL: '' }): CopilotProvider {
  const baseURL = withoutTrailingSlash(settings.baseURL ?? 'https://api.openai.com/v1')

  if (!baseURL) {
    throw new Error('baseURL is required')
  }

  const headers = {
    ...(settings.apiKey && { Authorization: `Bearer ${settings.apiKey}` }),
    ...settings.headers,
  }

  const getHeaders = () => withUserAgentSuffix(headers, 'ai-sdk/openai-compatible/0.1.0')

  const createChatModel = (modelId: string) => {
    return new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${settings.name ?? 'openai-compatible'}.chat`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: settings.fetch,
    })
  }

  const createResponsesModel = (modelId: string) => {
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${settings.name ?? 'openai-compatible'}.responses`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: settings.fetch,
    })
  }

  const tools: CopilotProviderTools = {
    webSearch: () => webSearch(),
    codeInterpreter: () => codeInterpreter(),
    imageGeneration: () => imageGeneration(),
    fileSearch: (args: { vectorStoreIds: Array<string> }) => fileSearch(args),
  }

  return {
    languageModel: createChatModel,
    chat: createChatModel,
    responses: createResponsesModel,
    tools,
  }
}

export type { ProviderDefinedTool, ProviderExecutedTool }
