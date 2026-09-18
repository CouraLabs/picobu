import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { anthropicOAuth } from '../../src/auth/anthropic.ts'
import { openaiOAuth } from '../../src/auth/openai.ts'
import { redactTokenBody } from '../../src/auth/redact.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const realFetch = globalThis.fetch

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'picobu-redact-'))
  initLockDir(dir)
})
afterEach(() => {
  globalThis.fetch = realFetch
  void rm(dir, { recursive: true, force: true })
})

const jsonResponse = (body: string, status = 200): Response => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })

const ACCESS = 'at-secret-abc123'
const REFRESH = 'rt-secret-xyz789'

describe('redactTokenBody', () => {
  test('redacts secret fields in a JSON body', () => {
    const body = JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 'soon' })
    const redacted = redactTokenBody(body)
    expect(redacted).not.toContain(ACCESS)
    expect(redacted).not.toContain(REFRESH)
    expect(redacted).toContain('[redacted]')
    expect(redacted).toContain('expires_in')
  })

  test('truncates non-JSON bodies', () => {
    const body = 'x'.repeat(500)
    const redacted = redactTokenBody(body)
    expect(redacted.length).toBeLessThan(body.length)
    expect(redacted.startsWith('x'.repeat(160))).toBe(true)
  })
})

describe('oauth token errors do not leak credentials', () => {
  test('anthropic refresh with malformed 200 body', async () => {
    globalThis.fetch = Object.assign(async () => jsonResponse(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: '3600' })), {
      preconnect: realFetch.preconnect,
    })
    const credential = { type: 'oauth' as const, access: ACCESS, refresh: REFRESH, expires: Date.now() - 1000 }
    const error = await anthropicOAuth.refresh(credential, AbortSignal.timeout(5000)).catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).not.toContain(ACCESS)
    expect(message).not.toContain(REFRESH)
  })

  test('openai refresh with malformed 200 body', async () => {
    globalThis.fetch = Object.assign(async () => jsonResponse(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: '3600' })), {
      preconnect: realFetch.preconnect,
    })
    const credential = { type: 'oauth' as const, access: ACCESS, refresh: REFRESH, expires: Date.now() - 1000 }
    const error = await openaiOAuth.refresh(credential, AbortSignal.timeout(5000)).catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).not.toContain(ACCESS)
    expect(message).not.toContain(REFRESH)
  })

  test('anthropic non-2xx error body is redacted', async () => {
    globalThis.fetch = Object.assign(async () => jsonResponse(JSON.stringify({ access_token: ACCESS, error: 'invalid_grant' }), 400), {
      preconnect: realFetch.preconnect,
    })
    const credential = { type: 'oauth' as const, access: ACCESS, refresh: REFRESH, expires: Date.now() - 1000 }
    const error = await anthropicOAuth.refresh(credential, AbortSignal.timeout(5000)).catch((e: unknown) => e as Error)
    const message = (error as Error).message
    expect(message).not.toContain(ACCESS)
    expect(message).toContain('invalid_grant')
  })
})
