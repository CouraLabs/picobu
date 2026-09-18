import { describe, expect, test } from 'bun:test'
import { assertSafeUrl } from '../../src/agent/tools/web/browser.ts'

const blocked = (url: string): boolean => {
  try {
    assertSafeUrl(url, false)
    return false
  } catch (error) {
    return error instanceof Error && error.message.startsWith('Blocked URL')
  }
}

describe('assertSafeUrl SSRF guard', () => {
  test('blocks literal private hosts', () => {
    expect(blocked('http://127.0.0.1/x')).toBe(true)
    expect(blocked('http://localhost/x')).toBe(true)
    expect(blocked('http://169.254.169.254/latest/meta-data/')).toBe(true)
    expect(blocked('http://10.0.0.1/x')).toBe(true)
    expect(blocked('http://192.168.1.1/x')).toBe(true)
  })

  test('blocks IPv4-mapped IPv6 in dotted form', () => {
    expect(blocked('http://[::ffff:169.254.169.254]/x')).toBe(true)
    expect(blocked('http://[::ffff:127.0.0.1]/x')).toBe(true)
  })

  test('blocks IPv4-mapped IPv6 in hex form', () => {
    expect(blocked('http://[::ffff:a9fe:a9fe]/x')).toBe(true)
  })

  test('blocks unspecified and loopback IPv6', () => {
    expect(blocked('http://[::]/x')).toBe(true)
    expect(blocked('http://[::1]/x')).toBe(true)
  })

  test('blocks IPv6 unique-local and link-local', () => {
    expect(blocked('http://[fc00::1]/x')).toBe(true)
    expect(blocked('http://[fe80::1]/x')).toBe(true)
  })

  test('allows public hosts and IPv6', () => {
    expect(blocked('https://example.com/x')).toBe(false)
    expect(blocked('http://[2001:db8::1]/x')).toBe(false)
  })

  test('blocks non-http protocols', () => {
    expect(blocked('file:///etc/passwd')).toBe(true)
    expect(blocked('ftp://example.com/x')).toBe(true)
  })
})
