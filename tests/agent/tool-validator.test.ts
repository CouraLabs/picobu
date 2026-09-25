import { describe, expect, test } from 'bun:test'
import type { ModelMessage } from 'ai'
import { buildToolValidatorPrompt, extractValidatorContext, toolValidatorPrompt, validateToolCall, validatorSchema } from '../../src/agent/prompts/tool-validator.ts'

describe('buildToolValidatorPrompt', () => {
  test('carries the base prompt, JSON guidance and the tool call', () => {
    const prompt = buildToolValidatorPrompt({ toolName: 'shell', input: { command: 'ls' } })
    expect(prompt).toContain(toolValidatorPrompt)
    expect(prompt).toContain('"approved"')
    expect(prompt).toContain('Tool call to validate:')
    expect(prompt).toContain('shell')
    expect(prompt).toContain('ls')
  })

  test('includes each provided context section in order', () => {
    const prompt = buildToolValidatorPrompt({
      toolName: 'edit',
      input: { path: 'a.ts' },
      userRequest: 'add dark mode',
      assistantMessage: 'I will edit a.ts',
      assistantThinking: 'first inspect the file',
      lastToolCall: 'read a.ts',
    })
    expect(prompt).toContain('User request:')
    expect(prompt).toContain('add dark mode')
    expect(prompt).toContain('Last assistant message:')
    expect(prompt).toContain('Last assistant thinking:')
    expect(prompt).toContain('Last tool request:')
    expect(prompt.indexOf('User request:')).toBeLessThan(prompt.indexOf('Tool call to validate:'))
  })

  test('omits absent context sections', () => {
    const prompt = buildToolValidatorPrompt({ toolName: 'shell', input: {} })
    expect(prompt).not.toContain('User request:')
    expect(prompt).not.toContain('Last assistant message:')
    expect(prompt).not.toContain('Last tool request:')
  })
})

describe('validatorSchema', () => {
  test('rejects a non-boolean verdict', () => {
    expect(validatorSchema.safeParse({ approved: 'yes' }).success).toBe(false)
  })
  test('accepts an approval verdict', () => {
    expect(validatorSchema.safeParse({ approved: true })).toEqual({ success: true, data: { approved: true } })
  })
  test('accepts a denial with a reason', () => {
    expect(validatorSchema.safeParse({ approved: false, reason: 'outside the workspace' })).toEqual({
      success: true,
      data: { approved: false, reason: 'outside the workspace' },
    })
  })
})

describe('extractValidatorContext', () => {
  test('pulls the last user, assistant text, thinking and tool call', () => {
    const messages: Array<ModelMessage> = [
      { role: 'user', content: 'add dark mode' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'inspect the file first' },
          { type: 'text', text: 'Editing App.tsx' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'edit', input: { path: 'App.tsx' } },
        ],
      },
    ]
    const ctx = extractValidatorContext(messages)
    expect(ctx.userRequest).toBe('add dark mode')
    expect(ctx.assistantMessage).toBe('Editing App.tsx')
    expect(ctx.assistantThinking).toBe('inspect the file first')
    expect(ctx.lastToolCall).toBe('edit {"path":"App.tsx"}')
  })

  test('empty messages yields an empty context', () => {
    expect(extractValidatorContext([])).toEqual({})
  })

  test('accepts a string-content assistant message', () => {
    const ctx = extractValidatorContext([{ role: 'assistant', content: 'done' }])
    expect(ctx.assistantMessage).toBe('done')
  })
})

describe('validateToolCall', () => {
  test('fails closed when no model is configured', async () => {
    const result = await validateToolCall({ toolName: 'shell', input: {} })
    expect(result.approved).toBe(false)
    expect(result.reason?.startsWith('Auto-pilot validator failed:')).toBe(true)
  })
})
