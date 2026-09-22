import { describe, expect, test } from 'bun:test'
import type { FetchLike } from '../../src/shared/update.ts'
import { dialogStatus } from '../../src/states/dialog.state.ts'
import { maybePromptForUpdate, startUpdateCheck } from '../../src/tui/hooks/update-check.ts'

const fetchNoUpdate: FetchLike = async () => Response.json([{ name: 'v0.0.1' }])

describe('update check', () => {
  test('opt-out short-circuits before any network call', async () => {
    await expect(maybePromptForUpdate({ enabled: false })).resolves.toBeUndefined()
    expect(dialogStatus().status).toBe('close')
  })
  test('no newer release keeps the dialog closed (injected fetch, no network)', async () => {
    await expect(maybePromptForUpdate({ enabled: true, fetchImpl: fetchNoUpdate })).resolves.toBeUndefined()
    expect(dialogStatus().status).toBe('close')
  })
  test('startUpdateCheck does not throw synchronously (opted out)', () => {
    expect(() => startUpdateCheck({ enabled: false })).not.toThrow()
    expect(dialogStatus().status).toBe('close')
  })
})
