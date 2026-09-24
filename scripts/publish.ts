import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bumpVersion } from '../src/shared/version.ts'

const root = join(import.meta.dir, '..')

export const runStep = (cmd: Array<string>, label: string): void => {
  const result = Bun.spawnSync(cmd, { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] })
  if (result.exitCode !== 0) throw new Error(`${label} failed with exit code ${result.exitCode}: ${cmd.join(' ')}`)
}

export const tagFor = (version: string): string => `v${version}`

export const slugFromUrl = (url: string): string => {
  const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(url.trim())
  const owner = match?.[1]
  const repo = match?.[2]
  if (!owner || !repo) throw new Error(`Cannot derive GitHub owner/repo from "${url}"`)
  return `${owner}/${repo}`
}

export const tokenFor = (env: Record<string, string | undefined>): string | undefined => {
  const token = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim()
  return token && token.length > 0 ? token : undefined
}

export const versionTagExists = (tag: string): boolean => {
  const result = Bun.spawnSync(['git', 'rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] })
  return result.exitCode === 0
}

export interface ReleaseDeps {
  hasGh: () => boolean
  exists: (tag: string) => boolean
  createGh: (tag: string) => boolean
  createApi: (slug: string, tag: string, token: string) => Promise<void>
  env: Record<string, string | undefined>
  log: (message: string) => void
}

export const ghAvailable = (): boolean => Bun.which('gh') !== null

export const releaseExists = (tag: string): boolean => {
  const result = Bun.spawnSync(['gh', 'release', 'view', tag], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] })
  return result.exitCode === 0
}

export const createReleaseGh = (tag: string): boolean => {
  const result = Bun.spawnSync(['gh', 'release', 'create', tag, '--generate-notes', '--verify-tag'], { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] })
  return result.exitCode === 0
}

export const createReleaseApi = async (slug: string, tag: string, token: string): Promise<void> => {
  const response = await fetch(`https://api.github.com/repos/${slug}/releases`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'picobu-publish',
    },
    body: JSON.stringify({ tag_name: tag, name: tag, generate_release_notes: true }),
  })
  const body = await response.text()
  if (response.status === 422 && body.includes('already_exists')) return
  if (!response.ok) throw new Error(`GitHub release API failed (${response.status}): ${body}`)
}

export const ensureRelease = async (slug: string, tag: string, deps: ReleaseDeps): Promise<void> => {
  if (deps.hasGh()) {
    if (deps.exists(tag)) {
      deps.log(`release ${tag} already exists, skipping`)
      return
    }
    if (deps.createGh(tag)) {
      deps.log(`created GitHub release ${tag} via gh`)
      return
    }
    deps.log('gh release create failed, falling back to GitHub API')
  }
  const token = tokenFor(deps.env)
  if (!token) throw new Error('cannot create GitHub release: gh unavailable/failed and neither GH_TOKEN nor GITHUB_TOKEN is set')
  await deps.createApi(slug, tag, token)
  deps.log(`created GitHub release ${tag} via GitHub API`)
}

const main = async (): Promise<void> => {
  runStep(['bun', 'run', 'tsc'], 'tsc')
  runStep(['bun', 'run', 'test'], 'unit tests')

  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown; repository?: { url?: unknown } } & Record<string, unknown>
  const current = String(pkg.version ?? '')
  const next = bumpVersion(current, 'build')
  pkg.version = next
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`version ${current} -> ${next}`)

  runStep(['bun', 'scripts/build.ts'], 'build')
  runStep(['bun', 'publish', '--access', 'public', '--cpu=*', '--os=*'], 'bun publish')

  const tag = tagFor(next)
  if (versionTagExists(tag)) {
    console.log(`tag ${tag} already exists, skipping`)
  } else {
    runStep(['git', 'tag', tag], 'git tag')
    runStep(['git', 'push', 'origin', tag], 'git push tag')
  }

  const slug = slugFromUrl(String(pkg.repository?.url ?? ''))
  await ensureRelease(slug, tag, {
    hasGh: ghAvailable,
    exists: releaseExists,
    createGh: createReleaseGh,
    createApi: createReleaseApi,
    env: process.env,
    log: (message) => {
      console.log(message)
    },
  })

  console.log(`released @couralabs/picobu@${next}`)
  console.log('install: bunx @couralabs/picobu (or bun add -g @couralabs/picobu)')
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exit(1)
  })
}
