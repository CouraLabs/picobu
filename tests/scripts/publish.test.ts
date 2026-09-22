import { describe, expect, test } from 'bun:test'
import { createReleaseApi, ensureRelease, type ReleaseDeps, runStep, slugFromUrl, tagFor, tokenFor } from '../../scripts/publish.ts'

describe('runStep', () => {
  test('passes through when the command succeeds', () => {
    expect(() => runStep(['bun', '--version'], 'bun version')).not.toThrow()
  })

  test('throws when the command fails so publish stops', () => {
    expect(() => runStep(['bun', 'run', 'no-such-script-xyz'], 'missing script')).toThrow('missing script')
  })
})

describe('tagFor', () => {
  test('prefixes the version with v', () => {
    expect(tagFor('1.31.1')).toBe('v1.31.1')
  })
})

describe('slugFromUrl', () => {
  test('parses git+https with .git suffix', () => {
    expect(slugFromUrl('git+https://github.com/CouraLabs/picobu.git')).toBe('CouraLabs/picobu')
  })

  test('parses plain https without .git suffix', () => {
    expect(slugFromUrl('https://github.com/CouraLabs/picobu')).toBe('CouraLabs/picobu')
  })

  test('parses ssh style urls', () => {
    expect(slugFromUrl('git@github.com:CouraLabs/picobu.git')).toBe('CouraLabs/picobu')
  })

  test('throws for non-github urls', () => {
    expect(() => slugFromUrl('https://gitlab.com/x/y')).toThrow('Cannot derive GitHub owner/repo')
  })
})

describe('tokenFor', () => {
  test('prefers GH_TOKEN and trims it', () => {
    expect(tokenFor({ GH_TOKEN: ' a ', GITHUB_TOKEN: 'b' })).toBe('a')
  })

  test('falls back to GITHUB_TOKEN', () => {
    expect(tokenFor({ GITHUB_TOKEN: 'b' })).toBe('b')
  })

  test('treats whitespace-only tokens as missing', () => {
    expect(tokenFor({ GH_TOKEN: '   ' })).toBeUndefined()
  })

  test('returns undefined when no token is set', () => {
    expect(tokenFor({})).toBeUndefined()
  })
})

describe('ensureRelease', () => {
  const makeDeps = (overrides: Partial<ReleaseDeps>): { deps: ReleaseDeps; calls: Array<string> } => {
    const calls: Array<string> = []
    const deps: ReleaseDeps = {
      hasGh: () => false,
      exists: () => false,
      createGh: () => false,
      createApi: () => Promise.resolve(),
      env: {},
      log: () => {},
      ...overrides,
    }
    return { deps, calls }
  }

  test('creates the release via gh when available and missing', async () => {
    const { deps, calls } = makeDeps({
      hasGh: () => true,
      createGh: (tag) => {
        calls.push(`gh:${tag}`)
        return true
      },
      log: (message) => {
        calls.push(`log:${message}`)
      },
    })
    await ensureRelease('owner/repo', 'v1.2.3', deps)
    expect(calls).toEqual(['gh:v1.2.3', 'log:created GitHub release v1.2.3 via gh'])
  })

  test('skips when the release already exists', async () => {
    const { deps, calls } = makeDeps({
      hasGh: () => true,
      exists: () => true,
      createGh: (tag) => {
        calls.push(`gh:${tag}`)
        return true
      },
      createApi: () => {
        calls.push('api')
        return Promise.resolve()
      },
      log: () => {},
    })
    await ensureRelease('owner/repo', 'v1.2.3', deps)
    expect(calls).toEqual([])
  })

  test('falls back to the API when gh create fails and a token is set', async () => {
    const { deps, calls } = makeDeps({
      hasGh: () => true,
      createGh: () => false,
      createApi: (slug, tag, token) => {
        calls.push(`api:${slug}:${tag}:${token}`)
        return Promise.resolve()
      },
      env: { GH_TOKEN: 'tok' },
      log: () => {},
    })
    await ensureRelease('owner/repo', 'v1.2.3', deps)
    expect(calls).toEqual(['api:owner/repo:v1.2.3:tok'])
  })

  test('uses the API directly when gh is absent and GITHUB_TOKEN is set', async () => {
    const { deps, calls } = makeDeps({
      hasGh: () => false,
      createApi: (slug, tag, token) => {
        calls.push(`api:${slug}:${tag}:${token}`)
        return Promise.resolve()
      },
      env: { GITHUB_TOKEN: 'tok' },
      log: () => {},
    })
    await ensureRelease('owner/repo', 'v1.2.3', deps)
    expect(calls).toEqual(['api:owner/repo:v1.2.3:tok'])
  })

  test('rejects when gh is absent and no token is set', async () => {
    const { deps, calls } = makeDeps({
      hasGh: () => false,
      env: {},
    })
    await expect(ensureRelease('owner/repo', 'v1.2.3', deps)).rejects.toThrow('cannot create GitHub release')
    expect(calls).toEqual([])
  })
})

describe('createReleaseApi', () => {
  const withFetch = async (status: number, body: string, run: () => Promise<void>): Promise<void> => {
    const original = globalThis.fetch
    globalThis.fetch = Object.assign(async () => new Response(body, { status }), { preconnect: original.preconnect })
    try {
      await run()
    } finally {
      globalThis.fetch = original
    }
  }

  test('treats an already-existing release as success', async () => {
    await withFetch(422, JSON.stringify({ message: 'Validation Failed', errors: [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }] }), async () => {
      await expect(createReleaseApi('owner/repo', 'v1.2.3', 'tok')).resolves.toBeUndefined()
    })
  })

  test('throws with the response body on other API errors', async () => {
    await withFetch(401, JSON.stringify({ message: 'Bad credentials' }), async () => {
      await expect(createReleaseApi('owner/repo', 'v1.2.3', 'tok')).rejects.toThrow('GitHub release API failed (401)')
    })
  })
})
