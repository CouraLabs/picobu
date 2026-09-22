import { describe, expect, test } from 'bun:test'
import { checkForUpdate, type FetchLike, installUpdate, latestVersionFromTags, relaunchCommand, updateCommand } from '../../src/shared/update.ts'

const tag = (name: string): { name?: string } => ({ name })

describe('update', () => {
  test('latestVersionFromTags picks the highest semver tag', () => {
    expect(latestVersionFromTags([tag('v1.9.0'), tag('v1.32.0'), tag('v1.31.0')])).toBe('1.32.0')
  })
  test('latestVersionFromTags ignores non-version tags', () => {
    expect(latestVersionFromTags([tag('nightly'), tag('1.2.3'), tag('v1.2'), {}])).toBeUndefined()
    expect(latestVersionFromTags([])).toBeUndefined()
  })
  test('checkForUpdate returns info only when latest is newer', async () => {
    const fetchOk: FetchLike = async () => Response.json([tag('v9.9.9')])
    await expect(checkForUpdate('1.31.0', fetchOk)).resolves.toEqual({ current: '1.31.0', latest: '9.9.9' })
    await expect(checkForUpdate('9.9.9', fetchOk)).resolves.toBeUndefined()
  })
  test('checkForUpdate swallows fetch failures and non-ok responses', async () => {
    const fetchThrow: FetchLike = async () => {
      throw new Error('offline')
    }
    await expect(checkForUpdate('1.31.0', fetchThrow)).resolves.toBeUndefined()
    const fetch404: FetchLike = async () => new Response('not found', { status: 404 })
    await expect(checkForUpdate('1.31.0', fetch404)).resolves.toBeUndefined()
  })
  test('updateCommand builds the forced global install command', () => {
    expect(updateCommand('1.32.0')).toEqual(['bun', 'add', '-g', '@couralabs/picobu@1.32.0', '--force'])
  })
  test('installUpdate reports success only on exit code 0', async () => {
    const seen: Array<Array<string>> = []
    const okSpawn = (options: { cmd: Array<string> }) => {
      seen.push(options.cmd)
      return { exited: Promise.resolve(0), stdout: new Response('').body as ReadableStream<Uint8Array>, stderr: new Response('').body as ReadableStream<Uint8Array> }
    }
    const ok = await installUpdate('1.32.0', okSpawn)
    expect(ok.ok).toBe(true)
    expect(seen[0]).toEqual(updateCommand('1.32.0'))
    const failSpawn = () => ({ exited: Promise.resolve(1), stdout: new Response('boom').body as ReadableStream<Uint8Array>, stderr: new Response('').body as ReadableStream<Uint8Array> })
    const failed = await installUpdate('1.32.0', failSpawn)
    expect(failed.ok).toBe(false)
    expect(failed.output).toBe('boom')
  })
  test('relaunchCommand targets the picobu bin', () => {
    if (process.platform === 'win32') expect(relaunchCommand()).toEqual(['cmd', '/c', 'picobu'])
    else expect(relaunchCommand()).toEqual(['picobu'])
  })
})
