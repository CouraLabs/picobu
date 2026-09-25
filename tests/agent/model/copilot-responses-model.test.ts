import { describe, expect, mock, test } from 'bun:test'
import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import { convertToOpenAIResponsesInput } from '../../../src/agent/model/providers/copilot/responses/convert-to-openai-responses-input.ts'
import { OpenAIResponsesLanguageModel } from '../../../src/agent/model/providers/copilot/responses/openai-responses-language-model.ts'

const TEST_PROMPT: LanguageModelV4Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]

interface CopilotMetadata {
  itemId?: string
  reasoningEncryptedContent?: string | null
  responseId?: string
}

interface Part {
  type: string
  providerMetadata?: { copilot?: CopilotMetadata; openai?: unknown }
}

function createMockFetch(body: unknown) {
  return mock(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
}

function createModel(fetchFn: typeof fetch) {
  return new OpenAIResponsesLanguageModel('test-model', {
    provider: 'copilot',
    url: () => 'https://api.test.com/responses',
    headers: () => ({ Authorization: 'Bearer test-token' }),
    fetch: fetchFn,
  })
}

describe('doGenerate', () => {
  test('attaches item metadata under the copilot namespace, not openai', async () => {
    const mockFetch = createMockFetch({
      id: 'resp_1',
      created_at: 0,
      model: 'gpt-5.5',
      output: [
        {
          type: 'reasoning',
          id: 'rs_1',
          encrypted_content: 'enc_1',
          summary: [{ type: 'summary_text', text: 'thinking...' }],
        },
        {
          type: 'message',
          role: 'assistant',
          id: 'msg_1',
          content: [{ type: 'output_text', text: 'Hello there', annotations: [] }],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'bash',
          arguments: '{}',
          id: 'fc_1',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const model = createModel(mockFetch)

    const { content, providerMetadata } = await model.doGenerate({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const reasoning = content.find((part) => part.type === 'reasoning') as Part | undefined
    expect(reasoning?.providerMetadata?.copilot?.itemId).toBe('rs_1')
    expect(reasoning?.providerMetadata?.copilot?.reasoningEncryptedContent).toBe('enc_1')
    expect(reasoning?.providerMetadata?.openai).toBeUndefined()

    const text = content.find((part) => part.type === 'text') as Part | undefined
    expect(text?.providerMetadata?.copilot?.itemId).toBe('msg_1')
    expect(text?.providerMetadata?.openai).toBeUndefined()

    const toolCall = content.find((part) => part.type === 'tool-call') as Part | undefined
    expect(toolCall?.providerMetadata?.copilot?.itemId).toBe('fc_1')
    expect(toolCall?.providerMetadata?.openai).toBeUndefined()

    expect(providerMetadata?.copilot?.responseId).toBe('resp_1')
    expect(providerMetadata?.openai).toBeUndefined()
  })

  test('sends prompt_cache_key from copilot provider options', async () => {
    let body: unknown
    const mockFetch = (async (_input: unknown, init?: { body?: unknown }) => {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      return new Response(JSON.stringify({ id: 'resp_1', created_at: 0, model: 'gpt-5.5', output: [], usage: { input_tokens: 1, output_tokens: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const model = createModel(mockFetch)

    await model.doGenerate({ prompt: TEST_PROMPT, providerOptions: { copilot: { promptCacheKey: 'sess-abc' } } })

    expect((body as { prompt_cache_key?: string }).prompt_cache_key).toBe('sess-abc')
  })
})

describe('convertToOpenAIResponsesInput', () => {
  test('echoes a stale tool-call itemId from the copilot namespace as the function_call id', async () => {
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'bash',
              input: { command: 'ls' },
              providerOptions: { copilot: { itemId: 'fc_999' } },
            },
          ],
        },
      ],
      systemMessageMode: 'system',
      store: false,
    })

    expect(input).toEqual([
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'bash',
        arguments: JSON.stringify({ command: 'ls' }),
        id: 'fc_999',
      },
    ])
  })

  test('omits the function_call id once the stale copilot itemId has been stripped', async () => {
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'bash',
              input: { command: 'ls' },
              providerOptions: {},
            },
          ],
        },
      ],
      systemMessageMode: 'system',
      store: false,
    })

    expect((input[0] as { id?: string }).id).toBeUndefined()
  })

  test('preserves reasoning items keyed by the copilot namespace instead of dropping them', async () => {
    const { input, warnings } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'thinking...',
              providerOptions: { copilot: { itemId: 'rs_1', reasoningEncryptedContent: 'enc_1' } },
            },
          ],
        },
      ],
      systemMessageMode: 'system',
      store: false,
    })

    expect(warnings).toEqual([])
    expect(input).toEqual([
      {
        type: 'reasoning',
        id: 'rs_1',
        encrypted_content: 'enc_1',
        summary: [{ type: 'summary_text', text: 'thinking...' }],
      },
    ])
  })

  test('drops reasoning items with no copilot itemId and warns, as before', async () => {
    const { input, warnings } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [{ type: 'reasoning', text: 'thinking...', providerOptions: {} }],
        },
      ],
      systemMessageMode: 'system',
      store: false,
    })

    expect(input).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      message: expect.stringContaining('Non-OpenAI reasoning parts are not supported'),
    })
  })

  test('reads imageDetail from the copilot namespace on user file parts', async () => {
    const { input } = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'image/png',
              data: { type: 'data', data: 'aGVsbG8=' },
              providerOptions: { copilot: { imageDetail: 'high' } },
            },
          ],
        },
      ],
      systemMessageMode: 'system',
      store: false,
    })

    const first = input[0] as { content: Array<{ detail?: string }> }
    expect(first.content[0]?.detail).toBe('high')
  })
})
