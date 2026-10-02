import { afterEach, describe, expect, test } from 'bun:test'
import { LOCAL_PRESET_PROBE_TIMEOUT_MS, LOCAL_PROVIDER_PRESETS, localPresetApiKey, localPresetBaseUrl, modelsUrlForBaseUrl } from '../../../src/agent/model/local-presets.ts'

const preset = (id: string) => {
  const found = LOCAL_PROVIDER_PRESETS.find((entry) => entry.id === id)
  if (!found) throw new Error(`missing preset ${id}`)
  return found
}

const ENV_KEYS = ['LITELLM_BASE_URL', 'LITELLM_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_API_KEY', 'LMSTUDIO_BASE_URL', 'LMSTUDIO_API_KEY']

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('LOCAL_PROVIDER_PRESETS', () => {
  test('defaults are the documented local URLs', () => {
    expect(LOCAL_PROVIDER_PRESETS.map((entry) => entry.id)).toEqual(['litellm', 'ollama', 'lmstudio'])
    expect(LOCAL_PROVIDER_PRESETS.map((entry) => entry.defaultBaseUrl)).toEqual(['http://localhost:4000/v1', 'http://localhost:11434/v1', 'http://localhost:1234/v1'])
  })

  test('every preset is openai-compatible over the openai-compatible npm', () => {
    for (const entry of LOCAL_PROVIDER_PRESETS) {
      expect(entry.type).toBe('openai-compatible')
      expect(entry.npm).toBe('@ai-sdk/openai-compatible')
    }
  })

  test('probe timeout is short enough for startup', () => {
    expect(LOCAL_PRESET_PROBE_TIMEOUT_MS).toBeGreaterThan(0)
    expect(LOCAL_PRESET_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5000)
  })
})

describe('localPresetBaseUrl', () => {
  test('falls back to the default without an env override', () => {
    expect(localPresetBaseUrl(preset('litellm'))).toBe('http://localhost:4000/v1')
  })

  test('env override wins and a trailing slash is stripped', () => {
    process.env.LITELLM_BASE_URL = 'http://box:4000/v1/'
    expect(localPresetBaseUrl(preset('litellm'))).toBe('http://box:4000/v1')
  })

  test('blank env values fall back to the default', () => {
    process.env.OLLAMA_BASE_URL = '   '
    expect(localPresetBaseUrl(preset('ollama'))).toBe('http://localhost:11434/v1')
  })
})

describe('localPresetApiKey', () => {
  test('is undefined when the env var is unset', () => {
    for (const entry of LOCAL_PROVIDER_PRESETS) expect(localPresetApiKey(entry)).toBeUndefined()
  })

  test('reads the env var when set and trims it', () => {
    process.env.OLLAMA_API_KEY = '  k  '
    expect(localPresetApiKey(preset('ollama'))).toBe('k')
  })

  test('treats a blank env value as no key', () => {
    process.env.LMSTUDIO_API_KEY = '   '
    expect(localPresetApiKey(preset('lmstudio'))).toBeUndefined()
  })
})

describe('modelsUrlForBaseUrl', () => {
  test('appends /models once', () => {
    expect(modelsUrlForBaseUrl('http://localhost:4000/v1')).toBe('http://localhost:4000/v1/models')
    expect(modelsUrlForBaseUrl('http://localhost:4000/v1/')).toBe('http://localhost:4000/v1/models')
  })
})
