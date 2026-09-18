import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.PICOBU_SYSTEM_DIR = await mkdtemp(join(tmpdir(), 'picobu-layout-'))

const { DEFAULT_SESSION_STATUS_LAYOUT } = await import('../../src/config/session-layout.ts')
const { headerLayout, resetSessionLayout, saveSessionLayout, statusLayout } = await import('../../src/states/session-layout.state.ts')

describe('saveSessionLayout', () => {
  test('updates the status layout signal', async () => {
    const next = { lines: [['agent' as const]], columnGap: 2, rowGap: 1 }
    await saveSessionLayout({ status: next })
    expect(statusLayout()).toEqual(next)
  })
  test('updates the header layout signal', async () => {
    const next = { lines: [['workspace' as const]], columnGap: 1, rowGap: 0 }
    await saveSessionLayout({ header: next })
    expect(headerLayout()).toEqual(next)
  })
  test('reset restores the defaults', async () => {
    await saveSessionLayout({ status: { lines: [['cost' as const]], columnGap: 3, rowGap: 2 } })
    await resetSessionLayout('status')
    expect(statusLayout()).toEqual(DEFAULT_SESSION_STATUS_LAYOUT)
  })
})
