import { describe, expect, test } from 'bun:test'
import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import { isMissingResponsesScopeError, withResponsesFallback } from '../../src/agent/model/openai-fallback.ts'

const callOptions: LanguageModelV4CallOptions = { prompt: [] }

const emptyStream = (): ReadableStream<LanguageModelV4StreamPart> => new ReadableStream<LanguageModelV4StreamPart>({ start: (controller) => controller.close() })

const okGenerate = (): LanguageModelV4GenerateResult => ({
  content: [],
  finishReason: { unified: 'stop', raw: undefined },
  usage: {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  },
  warnings: [],
})

const scopeError = (statusCode = 401): APICallError =>
  new APICallError({
    message: 'You have insufficient permissions for this operation. Missing scopes: api.responses.write.',
    url: 'https://api.openai.com/v1/responses',
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({ error: { message: 'Missing scopes: api.responses.write' } }),
  })

const recording =
  (calls: Array<string>): ((label: string) => void) =>
  (label) => {
    calls.push(label)
  }

const okModel = (id: string, calls: Array<string>, supportedUrls: Record<string, Array<RegExp>> = {}): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: id,
  modelId: 'gpt-5',
  supportedUrls,
  doGenerate: () => {
    recording(calls)(`${id}:generate`)
    return Promise.resolve(okGenerate())
  },
  doStream: () => {
    recording(calls)(`${id}:stream`)
    return Promise.resolve({ stream: emptyStream() } satisfies LanguageModelV4StreamResult)
  },
})

const failingModel = (id: string, error: unknown, calls: Array<string>, supportedUrls: Record<string, Array<RegExp>> = {}): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: id,
  modelId: 'gpt-5',
  supportedUrls,
  doGenerate: () => {
    recording(calls)(`${id}:generate`)
    return Promise.reject(error)
  },
  doStream: () => {
    recording(calls)(`${id}:stream`)
    return Promise.reject(error)
  },
})

describe('isMissingResponsesScopeError', () => {
  test('matches a 401 that names the responses write scope', () => {
    expect(isMissingResponsesScopeError(scopeError())).toBe(true)
  })
  test('matches a 403 that names the responses write scope', () => {
    expect(isMissingResponsesScopeError(scopeError(403))).toBe(true)
  })
  test('ignores statuses that are not permission errors', () => {
    expect(isMissingResponsesScopeError(scopeError(500))).toBe(false)
    expect(isMissingResponsesScopeError(scopeError(429))).toBe(false)
  })
  test('ignores unrelated 401s', () => {
    const error = new APICallError({
      message: 'Incorrect API key provided.',
      url: 'https://api.openai.com/v1/responses',
      requestBodyValues: {},
      statusCode: 401,
      responseBody: JSON.stringify({ error: { message: 'Incorrect API key provided.' } }),
    })
    expect(isMissingResponsesScopeError(error)).toBe(false)
  })
  test('ignores non api errors', () => {
    expect(isMissingResponsesScopeError(new Error('Missing scopes: api.responses.write'))).toBe(false)
    expect(isMissingResponsesScopeError(undefined)).toBe(false)
  })
})

describe('withResponsesFallback', () => {
  test('delegates metadata to the primary model', () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(okModel('openai.responses', calls), () => okModel('openai.chat', calls))
    expect(model.specificationVersion).toBe('v4')
    expect(model.provider).toBe('openai.responses')
    expect(model.modelId).toBe('gpt-5')
  })

  test('keeps the responses model when it succeeds', async () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(okModel('openai.responses', calls), () => okModel('openai.chat', calls))
    await model.doStream(callOptions)
    expect(calls).toEqual(['openai.responses:stream'])
  })

  test('falls back to chat completions on a missing scope stream error', async () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(failingModel('openai.responses', scopeError(), calls), () => okModel('openai.chat', calls))
    const result = await model.doStream(callOptions)
    expect(result.stream).toBeInstanceOf(ReadableStream)
    expect(calls).toEqual(['openai.responses:stream', 'openai.chat:stream'])
  })

  test('falls back to chat completions on a missing scope generate error', async () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(failingModel('openai.responses', scopeError(), calls), () => okModel('openai.chat', calls))
    const result = await model.doGenerate(callOptions)
    expect(result.content).toEqual([])
    expect(calls).toEqual(['openai.responses:generate', 'openai.chat:generate'])
  })

  test('reuses the chat model once the fallback engaged', async () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(failingModel('openai.responses', scopeError(), calls), () => okModel('openai.chat', calls))
    await model.doStream(callOptions)
    await model.doStream(callOptions)
    expect(calls).toEqual(['openai.responses:stream', 'openai.chat:stream', 'openai.chat:stream'])
  })

  test('propagates unrelated errors without engaging the fallback', async () => {
    const calls: Array<string> = []
    const failure = new Error('boom')
    const model = withResponsesFallback(failingModel('openai.responses', failure, calls), () => okModel('openai.chat', calls))
    await expect(model.doStream(callOptions)).rejects.toThrow('boom')
    expect(calls).toEqual(['openai.responses:stream'])
  })

  test('propagates an unrelated api error once the fallback engaged', async () => {
    const calls: Array<string> = []
    const chat = failingModel('openai.chat', new Error('chat failed'), calls)
    const primary = failingModel('openai.responses', scopeError(), calls)
    const model = withResponsesFallback(primary, () => chat)
    await expect(model.doStream(callOptions)).rejects.toThrow('chat failed')
    expect(calls).toEqual(['openai.responses:stream', 'openai.chat:stream'])
  })

  test('keeps the responses supported urls before the fallback engages', async () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(failingModel('openai.responses', scopeError(), calls, { 'application/pdf': [/^https?:\/\//] }), () =>
      okModel('openai.chat', calls, { 'image/*': [/^https?:\/\//] }),
    )
    expect(Object.keys(await model.supportedUrls)).toEqual(['application/pdf'])
  })

  test('swaps to the chat supported urls once the fallback engages', async () => {
    const calls: Array<string> = []
    const model = withResponsesFallback(failingModel('openai.responses', scopeError(), calls, { 'application/pdf': [/^https?:\/\//] }), () =>
      okModel('openai.chat', calls, { 'image/*': [/^https?:\/\//] }),
    )
    await model.doStream(callOptions)
    expect(Object.keys(await model.supportedUrls)).toEqual(['image/*'])
  })

  test('reports the fallback through the callback', async () => {
    const calls: Array<string> = []
    const seen: Array<string> = []
    const model = withResponsesFallback(failingModel('openai.responses', scopeError(), calls), () => okModel('openai.chat', calls), {
      onFallback: (next) => seen.push(next.provider),
    })
    await model.doStream(callOptions)
    expect(seen).toEqual(['openai.chat'])
  })
})
