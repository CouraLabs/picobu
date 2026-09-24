import { describe, expect, test } from 'bun:test'
import { type FetchLike, fetchLatestRelease, tagToVersion } from '../../src/shared/release.ts'

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const asFetch = (fn: () => Promise<Response>): FetchLike => fn as unknown as FetchLike

describe('release', () => {
  test('tagToVersion strips the v prefix and validates semver', () => {
    expect(tagToVersion('v0.34.1')).toBe('0.34.1')
    expect(tagToVersion(' 0.34.1 ')).toBe('0.34.1')
    expect(tagToVersion('nightly')).toBeUndefined()
    expect(tagToVersion('v0.34')).toBeUndefined()
    expect(tagToVersion('')).toBeUndefined()
  })
  test('fetchLatestRelease returns the release tag version', async () => {
    const fetchOk = asFetch(async () => jsonResponse({ tag_name: 'v0.35.0' }))
    await expect(fetchLatestRelease(fetchOk)).resolves.toBe('0.35.0')
  })
  test('fetchLatestRelease swallows failures and unusable bodies', async () => {
    const fetchThrow = asFetch(async () => {
      throw new Error('offline')
    })
    await expect(fetchLatestRelease(fetchThrow)).resolves.toBeUndefined()
    const fetch404 = asFetch(async () => jsonResponse({ message: 'Not Found' }, 404))
    await expect(fetchLatestRelease(fetch404)).resolves.toBeUndefined()
    const fetchEmpty = asFetch(async () => jsonResponse({}))
    await expect(fetchLatestRelease(fetchEmpty)).resolves.toBeUndefined()
  })
})
