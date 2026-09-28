import { describe, expect, test } from 'bun:test'
import { convertToOpenAICompatibleChatMessages as convertToCopilotMessages } from '../../../src/agent/model/providers/copilot/chat/convert-to-openai-compatible-chat-messages.ts'
import { OpenAICompatibleChatLanguageModel } from '../../../src/agent/model/providers/copilot/chat/openai-compatible-chat-language-model.ts'
import { createCopilotProvider } from '../../../src/agent/model/providers/copilot/copilot-provider.ts'

describe('system messages', () => {
  test('should convert system message content to string', () => {
    const result = convertToCopilotMessages([
      {
        role: 'system',
        content: 'You are a helpful assistant with AGENTS.md instructions.',
      },
    ])

    expect(result).toEqual([
      {
        role: 'system',
        content: 'You are a helpful assistant with AGENTS.md instructions.',
      },
    ])
  })
})

describe('user messages', () => {
  test('should convert messages with only a text part to a string content', () => {
    const result = convertToCopilotMessages([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    ])

    expect(result).toEqual([{ role: 'user', content: 'Hello' }])
  })

  test.each([
    ['Buffer', 'Hello', Buffer.from([0, 1, 2, 3]).toString('base64')],
    ['Uint8Array', 'Hi', new Uint8Array([0, 1, 2, 3])],
  ] as Array<[string, string, string | Uint8Array]>)('should convert messages with image parts from %s', (_kind, text, data) => {
    const result = convertToCopilotMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text },
          {
            type: 'file',
            data: { type: 'data', data },
            mediaType: 'image/png',
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,AAECAw==' },
          },
        ],
      },
    ])
  })

  test('should handle URL-based images', () => {
    const result = convertToCopilotMessages([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: { type: 'url', url: new URL('https://example.com/image.jpg') },
            mediaType: 'image/*',
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/image.jpg' },
          },
        ],
      },
    ])
  })

  test('should handle multiple text parts without flattening', () => {
    const result = convertToCopilotMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    ])
  })
})

describe('assistant messages', () => {
  test('should convert assistant text messages', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello back!' }],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'Hello back!',
        tool_calls: undefined,
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })

  test('should handle assistant message with null content when only tool calls', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call1',
            toolName: 'calculator',
            input: { a: 1, b: 2 },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'calculator',
              arguments: JSON.stringify({ a: 1, b: 2 }),
            },
          },
        ],
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })

  test('should concatenate multiple text parts', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First part. ' },
          { type: 'text', text: 'Second part.' },
        ],
      },
    ])

    expect(result[0]?.content).toBe('First part. Second part.')
  })
})

describe('tool calls', () => {
  test('should stringify arguments to tool calls', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            input: { foo: 'bar123' },
            toolCallId: 'quux',
            toolName: 'thwomp',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'quux',
            toolName: 'thwomp',
            output: { type: 'json', value: { oof: '321rab' } },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'quux',
            type: 'function',
            function: {
              name: 'thwomp',
              arguments: JSON.stringify({ foo: 'bar123' }),
            },
          },
        ],
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
      {
        role: 'tool',
        tool_call_id: 'quux',
        content: JSON.stringify({ oof: '321rab' }),
      },
    ])
  })

  test('should handle text output type in tool results', () => {
    const result = convertToCopilotMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'getWeather',
            output: { type: 'text', value: 'It is sunny today' },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 'It is sunny today',
      },
    ])
  })

  test('should handle multiple tool results as separate messages', () => {
    const result = convertToCopilotMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call1',
            toolName: 'api1',
            output: { type: 'text', value: 'Result 1' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call2',
            toolName: 'api2',
            output: { type: 'text', value: 'Result 2' },
          },
        ],
      },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      role: 'tool',
      tool_call_id: 'call1',
      content: 'Result 1',
    })
    expect(result[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call2',
      content: 'Result 2',
    })
  })

  test('should handle text plus multiple tool calls', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking... ' },
          {
            type: 'tool-call',
            toolCallId: 'call1',
            toolName: 'searchTool',
            input: { query: 'Weather' },
          },
          { type: 'text', text: 'Almost there...' },
          {
            type: 'tool-call',
            toolCallId: 'call2',
            toolName: 'mapsTool',
            input: { location: 'Paris' },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'Checking... Almost there...',
        tool_calls: [
          {
            id: 'call1',
            type: 'function',
            function: {
              name: 'searchTool',
              arguments: JSON.stringify({ query: 'Weather' }),
            },
          },
          {
            id: 'call2',
            type: 'function',
            function: {
              name: 'mapsTool',
              arguments: JSON.stringify({ location: 'Paris' }),
            },
          },
        ],
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })
})

describe('reasoning (copilot-specific)', () => {
  test('should omit reasoning_text without reasoning_opaque', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me think about this...' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'The answer is 42.',
        tool_calls: undefined,
        reasoning_text: undefined,
        reasoning_opaque: undefined,
      },
    ])
  })

  test('should include reasoning_opaque from providerOptions', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'Thinking...',
            providerOptions: {
              copilot: { reasoningOpaque: 'opaque-signature-123' },
            },
          },
          { type: 'text', text: 'Done!' },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'Done!',
        tool_calls: undefined,
        reasoning_text: 'Thinking...',
        reasoning_opaque: 'opaque-signature-123',
      },
    ])
  })

  test('should include reasoning_opaque from text part providerOptions', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Done!',
            providerOptions: {
              copilot: { reasoningOpaque: 'opaque-text-456' },
            },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'Done!',
        tool_calls: undefined,
        reasoning_text: undefined,
        reasoning_opaque: 'opaque-text-456',
      },
    ])
  })

  test('should handle reasoning-only assistant message', () => {
    const result = convertToCopilotMessages([
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'Just thinking, no response yet',
            providerOptions: {
              copilot: { reasoningOpaque: 'sig-abc' },
            },
          },
        ],
      },
    ])

    expect(result).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: undefined,
        reasoning_text: 'Just thinking, no response yet',
        reasoning_opaque: 'sig-abc',
      },
    ])
  })
})

describe('full conversation', () => {
  test('should convert a multi-turn conversation with reasoning', () => {
    const result = convertToCopilotMessages([
      {
        role: 'system',
        content: 'You are a helpful assistant.',
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'What is 2+2?' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'Let me calculate 2+2...',
            providerOptions: {
              copilot: { reasoningOpaque: 'sig-abc' },
            },
          },
          { type: 'text', text: '2+2 equals 4.' },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'What about 3+3?' }],
      },
    ])

    expect(result).toHaveLength(4)

    const systemMsg = result[0]
    expect(systemMsg?.role).toBe('system')

    const assistantMsg = result[2] as {
      reasoning_text?: string
      reasoning_opaque?: string
    }
    expect(assistantMsg.reasoning_text).toBe('Let me calculate 2+2...')
    expect(assistantMsg.reasoning_opaque).toBe('sig-abc')
  })
})

describe('prompt caching', () => {
  test('sends prompt_cache_key from copilot provider options', async () => {
    let body: unknown
    const fetchFn = (async (_input: unknown, init?: { body?: unknown }) => {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      return new Response(
        JSON.stringify({
          id: 'x',
          created: 0,
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const model = new OpenAICompatibleChatLanguageModel('gpt-4o', {
      provider: 'github-copilot.chat',
      url: () => 'https://api.test.com/chat/completions',
      headers: () => ({}),
      fetch: fetchFn,
    })
    await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], providerOptions: { copilot: { promptCacheKey: 'sess-abc' } } })
    expect((body as { prompt_cache_key?: string }).prompt_cache_key).toBe('sess-abc')
  })

  test('requests streaming usage so cached tokens are reported on the chat endpoint', async () => {
    let body: unknown
    const fetchFn = (async (_input: unknown, init?: { body?: unknown }) => {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      return new Response(
        'data: {"choices":[{"delta":{"content":"hi"}}],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11,"prompt_tokens_details":{"cached_tokens":7}}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof fetch
    const model = createCopilotProvider({ baseURL: 'https://api.test.com', name: 'github-copilot', fetch: fetchFn }).chat('gemini-2.5-pro')
    const { stream } = await model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
    const parts: Array<unknown> = []
    for await (const part of stream) parts.push(part)
    expect((body as { stream_options?: unknown }).stream_options).toEqual({ include_usage: true })
    const finish = parts.find((p) => (p as { type?: string }).type === 'finish') as { usage?: { inputTokens?: { cacheRead?: number } } } | undefined
    expect(finish?.usage?.inputTokens?.cacheRead).toBe(7)
  })
})
