import { describe, expect, test } from 'bun:test'
import { toPromptMessage } from '../../src/agent/sessions/session.ts'
import { sanitizePromptTextParts } from '../../src/agent/sessions/session-messages.ts'
import { replaceUnpairedSurrogates, sanitizePromptText } from '../../src/shared/prompt-text.ts'
import { truncate } from '../../src/shared/text-stats.ts'

const hasLoneSurrogate = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

describe('sanitizePromptText', () => {
  test('keeps quotes, backslashes, backticks and shell metacharacters', () => {
    const input = 'a "b" \'c\' `d` \\ $e !f {} [] () & | ; < > # @ % * ~ ^ ? / = + - , . :'
    expect(sanitizePromptText(input)).toBe(input)
  })

  test('keeps emoji, CJK and tabs', () => {
    expect(sanitizePromptText('😀 漢字\ttab')).toBe('😀 漢字\ttab')
  })

  test('normalizes CRLF and lone CR to LF', () => {
    expect(sanitizePromptText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  test('converts U+2028 and U+2029 to LF', () => {
    expect(sanitizePromptText('a\u2028b\u2029c')).toBe('a\nb\nc')
  })

  test('strips CSI escape sequences', () => {
    expect(sanitizePromptText('\u001b[31mred\u001b[0m')).toBe('red')
  })

  test('strips OSC escape sequences', () => {
    expect(sanitizePromptText('\u001b]0;title\u0007body')).toBe('body')
  })

  test('strips an OSC terminated with ST instead of BEL', () => {
    expect(sanitizePromptText('\u001b]0;title\u001b\\body')).toBe('body')
  })

  test('regression: an unterminated OSC does not swallow the rest of the paste', () => {
    expect(sanitizePromptText('before \u001b]0;title and the rest of my paste')).toBe('before 0;title and the rest of my paste')
    expect(sanitizePromptText('a\u001b]b')).toBe('ab')
  })

  test('regression: a huge unterminated OSC keeps its payload', () => {
    const payload = 'p'.repeat(3000)
    expect(sanitizePromptText(`x\u001b]${payload}`)).toBe(`x${payload}`)
  })

  test('strips remaining single-character escapes', () => {
    expect(sanitizePromptText('\u001bM')).toBe('')
  })

  test('strips NUL, BEL, DEL and C1 controls', () => {
    expect(sanitizePromptText('a\u0000b\u0007c\u007fd\u0085e')).toBe('abcde')
  })

  test('strips BOM and zero-width characters', () => {
    expect(sanitizePromptText('\ufeffa\u200bb')).toBe('ab')
  })

  test('replaces unpaired surrogates and keeps valid pairs', () => {
    expect(sanitizePromptText('a\ud83d')).toBe('a\ufffd')
    expect(sanitizePromptText('a\udc00b')).toBe('a\ufffdb')
    expect(sanitizePromptText('\ud83d\ude00')).toBe('\ud83d\ude00')
  })

  test('is idempotent', () => {
    const fixtures = ['a\r\nb\rc', 'a\u2028b\u2029c', '\u001b[31mred\u001b[0m', '\u001b]0;title\u0007body', '\u001bM', 'a\u0000b\u0007c\u007fd\u0085e', '\ufeffa\u200bb', 'a\ud83d', 'a\udc00b']
    for (const fixture of fixtures) {
      const once = sanitizePromptText(fixture)
      expect(sanitizePromptText(once)).toBe(once)
    }
  })

  test('keeps identity when nothing needs sanitizing', () => {
    const clean = 'plain text with "quotes" and it\'s fine'
    expect(sanitizePromptText(clean)).toBe(clean)
    expect(replaceUnpairedSurrogates(clean)).toBe(clean)
  })
})

describe('replaceUnpairedSurrogates', () => {
  test('keeps valid pairs intact', () => {
    expect(replaceUnpairedSurrogates('\ud83d\ude00')).toBe('\ud83d\ude00')
  })

  test('replaces lone high and low surrogates', () => {
    expect(replaceUnpairedSurrogates('a\ud83db')).toBe('a\ufffdb')
    expect(replaceUnpairedSurrogates('a\udc00b')).toBe('a\ufffdb')
  })
})

describe('sanitizePromptTextParts', () => {
  test('rewrites only text parts and keeps file parts untouched', () => {
    const input = {
      id: 'm1',
      role: 'user' as const,
      parts: [
        { type: 'text' as const, text: 'a\u0000b' },
        { type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,AAA' },
      ],
    }
    const out = sanitizePromptTextParts(input)
    expect(out.parts[0]).toEqual({ type: 'text', text: 'ab' })
    expect(out.parts[1]).toEqual(input.parts[1])
  })

  test('returns the same message object when nothing changes', () => {
    const input = { id: 'm2', role: 'user' as const, parts: [{ type: 'text' as const, text: 'clean' }] }
    expect(sanitizePromptTextParts(input)).toBe(input)
  })
})

describe('toPromptMessage', () => {
  test('sanitizes string prompts', () => {
    const message = toPromptMessage('a\u001b[31mb')
    const textPart = message.parts[0] as { type: string; text: string }
    expect(textPart.text).toBe('ab')
  })

  test('sanitizes object prompts with text parts', () => {
    const message = toPromptMessage({ parts: [{ type: 'text', text: 'x\r\ny\u0007' }] } as never)
    const textPart = message.parts[0] as { type: string; text: string }
    expect(textPart.text).toBe('x\ny')
  })

  test('regression: quotes and apostrophes survive a JSON round-trip', () => {
    const text = 'he said "hi" and it\'s fine — \u001b[1mno escapes\u001b[0m'
    const sanitized = sanitizePromptText(text)
    expect(sanitized).toContain('"hi"')
    expect(sanitized).toContain("it's")
    expect(sanitized).not.toContain('\u001b')
    expect(JSON.parse(JSON.stringify({ text: sanitized })).text).toBe(sanitized)
  })
})

describe('truncate', () => {
  test('does not split a surrogate pair', () => {
    const result = truncate('\ud83d\ude00'.repeat(40), 10)
    expect(result.endsWith('...')).toBe(true)
    expect(hasLoneSurrogate(result)).toBe(false)
  })

  test('never leaves a lone surrogate at any width', () => {
    for (let max = 1; max <= 40; max++) {
      expect(hasLoneSurrogate(truncate('\ud83d\ude00abcdef', max))).toBe(false)
      expect(hasLoneSurrogate(truncate('a\ud83d\ude00bcd', max))).toBe(false)
    }
  })

  test('regression: a narrow max drops the pair instead of half of it', () => {
    expect(truncate('\ud83d\ude00abcdef', 4)).toBe('...')
    expect(truncate('a\ud83d\ude00bcd', 5)).toBe('a...')
  })

  test('keeps short strings and plain clipping intact', () => {
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('abcdefghijklmnop', 10)).toBe('abcdefg...')
  })
})
