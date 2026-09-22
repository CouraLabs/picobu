import { describe, expect, test } from 'bun:test'
import { NATIVE_EXTERNALS, RUNTIME_ASSETS } from '../../scripts/build.ts'

describe('NATIVE_EXTERNALS', () => {
  test('keeps platform-native packages out of the bundle so they resolve from node_modules at runtime', () => {
    expect(NATIVE_EXTERNALS).toEqual(['@opentui/core-*', '@vscode/ripgrep*'])
  })
})

describe('RUNTIME_ASSETS', () => {
  test('copies the builtin prompt and workflow markdown next to the bundle', () => {
    expect(RUNTIME_ASSETS).toEqual([
      { from: 'src/agent/prompts/ask.md', to: 'ask.md' },
      { from: 'src/agent/prompts/brainstorm.md', to: 'brainstorm.md' },
      { from: 'src/agent/prompts/coder.md', to: 'coder.md' },
      { from: 'src/agent/prompts/plan.md', to: 'plan.md' },
      { from: 'src/agent/prompts/persistent.md', to: 'persistent.md' },
      { from: 'src/agent/prompts/executor.md', to: 'executor.md' },
      { from: 'src/agent/prompts/explorer.md', to: 'explorer.md' },
      { from: 'src/agent/prompts/reviewer.md', to: 'reviewer.md' },
      { from: 'src/agent/prompts/debugger.md', to: 'debugger.md' },
      { from: 'src/agent/workflows/init.md', to: 'init.md' },
      { from: 'src/agent/workflows/review.md', to: 'review.md' },
    ])
  })
})
