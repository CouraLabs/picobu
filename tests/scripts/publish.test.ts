import { describe, expect, test } from 'bun:test'
import {
  type AnnounceDeps,
  announceRelease,
  buildDiscordPayload,
  categorizeNotes,
  createReleaseApi,
  ensureRelease,
  INSTALL_COMMAND,
  type ReleaseDeps,
  renderBucket,
  runStep,
  slugFromUrl,
  tagFor,
  tokenFor,
} from '../../scripts/publish.ts'

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

describe('categorizeNotes', () => {
  test('buckets conventional prefixes', () => {
    const notes = categorizeNotes([
      'feat: add update command',
      'feat(tui): confirm dialog',
      'feature: x',
      'fix: patch notes',
      'fix(mcp): keep tools',
      'chore: bump',
      'docs: readme',
      'release: v1',
      'plain subject',
    ])
    expect(notes.features).toEqual(['feat: add update command', 'feat(tui): confirm dialog', 'feature: x'])
    expect(notes.fixes).toEqual(['fix: patch notes', 'fix(mcp): keep tools'])
    expect(notes.other).toEqual(['chore: bump', 'docs: readme', 'release: v1', 'plain subject'])
  })

  test('ignores blank and whitespace-only subjects', () => {
    expect(categorizeNotes(['', '   ', '\t'])).toEqual({ features: [], fixes: [], other: [] })
  })
})

describe('renderBucket', () => {
  test('renders bullets and truncates past the cap', () => {
    expect(renderBucket([])).toBe('—')
    expect(renderBucket(['a', 'b'])).toBe('• a\n• b')
    expect(renderBucket(Array.from({ length: 10 }, (_, i) => `s${i}`))).toBe('• s0\n• s1\n• s2\n• s3\n• s4\n• s5\n• s6\n• s7\n…and 2 more')
  })
})

describe('buildDiscordPayload', () => {
  test('includes categorized fields, install command and release link', () => {
    const payload = buildDiscordPayload('0.36.3', 'CouraLabs/picobu', categorizeNotes(['feat: a', 'fix: b', 'chore: c'])) as {
      content: string
      embeds: Array<{ url: string; fields: Array<{ name: string; value: string }> }>
    }
    expect(payload.content).toContain('Picobu v0.36.3')
    const embed = payload.embeds[0]
    expect(embed?.url).toBe('https://github.com/CouraLabs/picobu/releases/tag/v0.36.3')
    const names = embed?.fields.map((f) => f.name)
    expect(names).toEqual(['Features', 'Fixes', 'Other', 'Install', 'Release notes'])
    expect(embed?.fields.find((f) => f.name === 'Install')?.value).toBe(`\`${INSTALL_COMMAND}\``)
  })
})

describe('announceRelease', () => {
  const makeDeps = (overrides: Partial<AnnounceDeps>): AnnounceDeps => ({
    fetch,
    env: {},
    log: () => {},
    ...overrides,
  })

  test('skips when the webhook env var is missing', async () => {
    const calls: Array<string> = []
    const ok = await announceRelease('owner/repo', '0.1.0', categorizeNotes([]), makeDeps({ env: {}, log: (m) => calls.push(m) }))
    expect(ok).toBe(false)
    expect(calls[0]).toContain('PICOBU_DISCORD_WEBHOOK_URL not set')
  })

  test('posts and reports success', async () => {
    const calls: Array<string> = []
    let posted: string | undefined
    const fakeFetch = async (input: string): Promise<Response> => {
      posted = input
      return new Response('', { status: 204 })
    }
    const ok = await announceRelease(
      'owner/repo',
      '0.1.0',
      categorizeNotes(['feat: a']),
      makeDeps({ fetch: fakeFetch, env: { PICOBU_DISCORD_WEBHOOK_URL: 'https://example.test/hook' }, log: (m) => calls.push(m) }),
    )
    expect(ok).toBe(true)
    expect(posted).toBe('https://example.test/hook')
    expect(calls[0]).toContain('announced Picobu v0.1.0 on Discord')
  })

  test('reports failure without throwing on a non-ok response', async () => {
    const calls: Array<string> = []
    const fakeFetch = async (): Promise<Response> => new Response('bad', { status: 400 })
    const ok = await announceRelease(
      'owner/repo',
      '0.1.0',
      categorizeNotes([]),
      makeDeps({ fetch: fakeFetch, env: { PICOBU_DISCORD_WEBHOOK_URL: 'https://example.test/hook' }, log: (m) => calls.push(m) }),
    )
    expect(ok).toBe(false)
    expect(calls[0]).toContain('Discord announcement failed (400)')
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
