import { describe, expect, test } from 'bun:test'
import { assertSafeUrl } from '../../src/agent/tools/web/browser.ts'
import { parseSearchPage, resolveDdgHref } from '../../src/agent/tools/web/websearch.ts'

describe('assertSafeUrl', () => {
  test('allows public https', () => {
    expect(assertSafeUrl('https://example.com/page').hostname).toBe('example.com')
  })
  test('blocks file and data protocols', () => {
    expect(() => assertSafeUrl('file:///etc/passwd')).toThrow('protocol')
    expect(() => assertSafeUrl('data:text/plain,hi')).toThrow('protocol')
  })
  test('blocks private hosts unless allowed', () => {
    expect(() => assertSafeUrl('http://127.0.0.1/x')).toThrow('private')
    expect(() => assertSafeUrl('http://169.254.169.254/meta')).toThrow('private')
    expect(assertSafeUrl('http://127.0.0.1/x', true).hostname).toBe('127.0.0.1')
  })
})

describe('resolveDdgHref', () => {
  test('returns uddg target', () => {
    expect(resolveDdgHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa')).toBe('https://example.com/a')
  })
  test('drops duckduckgo link without uddg', () => {
    expect(resolveDdgHref('//duckduckgo.com/l/?rut=abc')).toBeNull()
  })
  test('passes through direct url', () => {
    expect(resolveDdgHref('https://example.com/direct')).toBe('https://example.com/direct')
  })
})

describe('parseSearchPage', () => {
  test('keeps each snippet with its own result', () => {
    const html = [
      `<a class="result__a" href="https://a.example/">A title</a>`,
      `<a class="result__snippet" href="x">snippet A</a>`,
      `<a class="result__a" href="https://b.example/">B title</a>`,
      `<a class="result__snippet" href="x">snippet B</a>`,
    ].join('')
    const parsed = parseSearchPage(html)
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0]?.url).toBe('https://a.example/')
    expect(parsed.results[0]?.snippet).toContain('snippet A')
    expect(parsed.results[1]?.snippet).toContain('snippet B')
  })
  test('skips ad without uddg', () => {
    const html = `<a class="result__a" href="//duckduckgo.com/l/?rut=ad">Ad</a>`
    expect(parseSearchPage(html).results).toHaveLength(0)
  })
})
