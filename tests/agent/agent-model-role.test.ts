import { beforeEach, describe, expect, test } from 'bun:test'
import { resolveAgentModel } from '../../src/agent/agents/registry.ts'
import { resetAuthCache } from '../../src/auth/store.ts'
import { mockOptions, resetMockOptions } from '../helpers/mock-options.ts'

beforeEach(() => {
  resetMockOptions()
  resetAuthCache()
})

describe('resolveAgentModel', () => {
  test('returns undefined for agents without a model role', () => {
    expect(resolveAgentModel('persistent')).toBeUndefined()
    expect(resolveAgentModel('nope')).toBeUndefined()
  })

  test('uses the role model with the role thinking effort', () => {
    mockOptions.harness = {
      defaultModel: 'openai/default',
      modelRoles: { flash: 'anthropic/flash-model', flashThinking: 'high', heavy: 'openai/heavy-model' },
    }
    expect(resolveAgentModel('coder')).toEqual({ modelKey: 'anthropic/flash-model', thinking: 'high' })
    expect(resolveAgentModel('plan-code')).toEqual({ modelKey: 'openai/heavy-model', thinking: 'high' })
  })

  test('falls back to the default model when the role is unset', () => {
    mockOptions.harness = { defaultModel: 'openai/default' }
    expect(resolveAgentModel('ask')).toEqual({ modelKey: 'openai/default', thinking: 'medium' })
    expect(resolveAgentModel('coder')).toEqual({ modelKey: 'openai/default', thinking: 'medium' })
    expect(resolveAgentModel('plan-code')).toEqual({ modelKey: 'openai/default', thinking: 'high' })
  })

  test('falls back to the first listed model when nothing is configured', () => {
    mockOptions.providers = [
      {
        id: 'prov',
        name: 'Prov',
        type: 'openai',
        baseUrl: 'https://api.prov.test/v1',
        models: [
          { id: 'm1', name: 'Model One', context: 1000, output: 100 },
          { id: 'm2', name: 'Model Two', context: 1000, output: 100 },
        ],
      },
    ]
    expect(resolveAgentModel('coder')).toEqual({ modelKey: 'prov/m1', thinking: 'medium' })
  })

  test('returns undefined when no models exist at all', () => {
    expect(resolveAgentModel('coder')).toBeUndefined()
  })
})
