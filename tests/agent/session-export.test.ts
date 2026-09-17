import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportSessionHtml, renderSessionHtml } from '../../src/agent/sessions/session-export.ts'

describe('renderSessionHtml', () => {
  test('renders messages, tools and the last step', () => {
    const html = renderSessionHtml({
      sessionId: 'abc123',
      title: 'demo',
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'tool-shell', toolCallId: 'c1', state: 'output-available', input: { command: 'ls' }, output: 'ok' }] },
      ] as never,
      stats: {
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        performance: {},
        warnings: undefined,
        headers: undefined,
        finishReason: 'stop',
        stepCount: 3,
        tokenTotals: { inputTokens: 30, outputTokens: 6 },
      } as never,
    })
    expect(html).toContain('abc123')
    expect(html).toContain('shell')
    expect(html).toContain('<table>')
    expect(html).toContain('Last step')
    expect(html).toContain('3 steps')
    expect(html).toContain('30 in / 6 out tokens')
  })
  test('escapes html in content', () => {
    const html = renderSessionHtml({ sessionId: 'x', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '<script>alert(1)</script>' }] }] as never })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('exportSessionHtml writes file', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-export-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('writes html to out path', async () => {
    const out = join(dir, 'session.html')
    const written = await exportSessionHtml({ sessionId: 'nope-missing', messages: [], out })
    expect(written).toBe(out)
    const text = await Bun.file(out).text()
    expect(text).toContain('nope-missing')
  })
})
