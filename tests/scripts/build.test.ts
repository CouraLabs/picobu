import { describe, expect, test } from 'bun:test'
import { NATIVE_EXTERNALS, RUNTIME_ASSETS } from '../../scripts/build.ts'

describe('NATIVE_EXTERNALS', () => {
  test('keeps platform-native packages out of the bundle so they resolve from node_modules at runtime', () => {
    expect(NATIVE_EXTERNALS).toEqual(['@opentui/core-*', '@vscode/ripgrep*'])
  })
})

describe('RUNTIME_ASSETS', () => {
  test('copies the builtin workflow markdown next to the bundle', () => {
    expect(RUNTIME_ASSETS).toEqual([
      { from: 'src/agent/workflows/init.md', to: 'init.md' },
      { from: 'src/agent/workflows/review.md', to: 'review.md' },
    ])
  })
})
