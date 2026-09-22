import { logWarn } from '@shared/logger.ts'
import { compareVersions, getVersion } from '@shared/version.ts'

export const PACKAGE_NAME = '@couralabs/picobu'
export const GITHUB_REPO = 'CouraLabs/picobu'
export const TAGS_URL = `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=100`
export const UPDATE_TIMEOUT_MS = 8000

export interface TagEntry {
  name?: string
}
export interface UpdateInfo {
  current: string
  latest: string
}
export interface InstallResult {
  ok: boolean
  output: string
}
export interface SpawnResultLike {
  exited: Promise<number>
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
}
export interface InstallSpawnOptions {
  cmd: Array<string>
  stdin: 'ignore'
  stdout: 'pipe'
  stderr: 'pipe'
}
export type SpawnImpl = (options: InstallSpawnOptions) => SpawnResultLike
export interface RelaunchSpawnOptions {
  cmd: Array<string>
  stdin: 'inherit'
  stdout: 'inherit'
  stderr: 'inherit'
  detached: true
}
export interface RelaunchSpawnResultLike {
  unref?: () => void
}
export type RelaunchSpawnImpl = (options: RelaunchSpawnOptions) => RelaunchSpawnResultLike
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const VERSION_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/

export const latestVersionFromTags = (tags: Array<TagEntry>): string | undefined => {
  let best: string | undefined
  for (const entry of tags) {
    const name = typeof entry?.name === 'string' ? entry.name : ''
    const match = VERSION_TAG_PATTERN.exec(name)
    if (!match?.[1]) continue
    if (best === undefined || compareVersions(match[1], best) > 0) best = match[1]
  }
  return best
}

export const fetchLatestVersion = async (fetchImpl: FetchLike = fetch, timeoutMs: number = UPDATE_TIMEOUT_MS): Promise<string | undefined> => {
  try {
    const response = await fetchImpl(TAGS_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'picobu' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      logWarn(`update check: github tags request failed with status ${response.status}`)
      return undefined
    }
    const tags = (await response.json()) as Array<TagEntry>
    return latestVersionFromTags(Array.isArray(tags) ? tags : [])
  } catch (error) {
    logWarn('update check failed', { error: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}

export const checkForUpdate = async (current: string = getVersion(), fetchImpl: FetchLike = fetch): Promise<UpdateInfo | undefined> => {
  const latest = await fetchLatestVersion(fetchImpl)
  if (latest === undefined || compareVersions(latest, current) <= 0) return undefined
  return { current, latest }
}

export const updateCommand = (version: string): Array<string> => ['bun', 'add', '-g', `${PACKAGE_NAME}@${version}`, '--force']

const defaultInstallSpawn: SpawnImpl = (options): SpawnResultLike => {
  const proc = Bun.spawn({ cmd: options.cmd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  return { exited: proc.exited, stdout: proc.stdout, stderr: proc.stderr }
}

export const installUpdate = async (version: string, spawnImpl: SpawnImpl = defaultInstallSpawn): Promise<InstallResult> => {
  try {
    const proc = spawnImpl({ cmd: updateCommand(version), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      return { ok: false, output: `${stdout}${stderr}`.trim() }
    }
    return { ok: true, output: stdout.trim() }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) }
  }
}

export const relaunchCommand = (): Array<string> => (process.platform === 'win32' ? ['cmd', '/c', 'picobu'] : ['picobu'])

const defaultRelaunchSpawn: RelaunchSpawnImpl = (options): RelaunchSpawnResultLike => {
  const child = Bun.spawn({ cmd: options.cmd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', detached: true })
  return { unref: () => child.unref() }
}

export const relaunchApp = (spawnImpl: RelaunchSpawnImpl = defaultRelaunchSpawn): void => {
  try {
    const child = spawnImpl({ cmd: relaunchCommand(), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', detached: true })
    child.unref?.()
  } catch {}
}
