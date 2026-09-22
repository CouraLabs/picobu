import { APICallError, type LanguageModelV4 } from '@ai-sdk/provider'

const RESPONSES_WRITE_SCOPE = 'api.responses.write'
const SCOPE_ERROR_STATUSES: ReadonlyArray<number> = [401, 403]

export const isMissingResponsesScopeError = (error: unknown): boolean => {
  if (!APICallError.isInstance(error)) return false
  if (error.statusCode === undefined || !SCOPE_ERROR_STATUSES.includes(error.statusCode)) return false
  const body = typeof error.responseBody === 'string' ? error.responseBody : ''
  return body.includes(RESPONSES_WRITE_SCOPE) || error.message.includes(RESPONSES_WRITE_SCOPE)
}

interface FallbackOptions {
  onFallback?: (model: LanguageModelV4) => void
}

export const withResponsesFallback = (responses: LanguageModelV4, chat: () => LanguageModelV4, opts?: FallbackOptions): LanguageModelV4 => {
  let active: LanguageModelV4 | undefined
  const run = async <TValue>(call: (model: LanguageModelV4) => PromiseLike<TValue>): Promise<TValue> => {
    if (active) return call(active)
    try {
      return await call(responses)
    } catch (error) {
      if (!isMissingResponsesScopeError(error)) throw error
      active = chat()
      opts?.onFallback?.(active)
      return call(active)
    }
  }
  return {
    specificationVersion: 'v4',
    provider: responses.provider,
    modelId: responses.modelId,
    get supportedUrls(): LanguageModelV4['supportedUrls'] {
      return (active ?? responses).supportedUrls
    },
    doGenerate: (options) => run((model) => model.doGenerate(options)),
    doStream: (options) => run((model) => model.doStream(options)),
  }
}
