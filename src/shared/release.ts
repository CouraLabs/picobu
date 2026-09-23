import { logWarn } from '@shared/logger.ts'

export const GITHUB_REPO = 'CouraLabs/picobu'
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
export const RELEASE_TIMEOUT_MS = 8000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const tagToVersion = (tag: string): string | undefined => {
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim())
  return match?.[1]
}

export const fetchLatestRelease = async (fetchImpl: FetchLike = fetch, timeoutMs: number = RELEASE_TIMEOUT_MS): Promise<string | undefined> => {
  try {
    const response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'picobu' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      logWarn(`release check: github request failed with status ${response.status}`)
      return undefined
    }
    const body = (await response.json()) as { tag_name?: unknown }
    const tag = typeof body?.tag_name === 'string' ? body.tag_name : ''
    return tagToVersion(tag)
  } catch (error) {
    logWarn('release check failed', { error: error instanceof Error ? error.message : String(error) })
    return undefined
  }
}
