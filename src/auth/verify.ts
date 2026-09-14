import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fetchCopilotModelsWithCredential, getGitHubCopilotBaseUrl, parseGitHubCopilotModelCatalog } from '@auth/github-copilot.ts'
import { setCredential } from '@auth/store.ts'
import type { OAuthAuth, OAuthCredential } from '@auth/types.ts'

const REFRESH_GRACE_MS = 5 * 60 * 1000
const VERIFY_TIMEOUT_MS = 30_000
const COPILOT_INDIVIDUAL_BASE_URL = 'https://api.individual.githubcopilot.com'

export interface VerifyOk {
  ok: true
  modelCount: number
  credential: OAuthCredential
  modelIds: Array<string>
}

export interface VerifyFail {
  ok: false
  error: string
}

export type VerifyResult = VerifyOk | VerifyFail

const modelIdsFromStandardCatalog = (raw: unknown): Array<string> => {
  const data = (raw as { data?: unknown } | null | undefined)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const id = (entry as { id?: unknown } | null | undefined)?.id
    return typeof id === 'string' && id.length > 0 ? [id] : []
  })
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const fetchOpenAIModels = async (access: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${access}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(VERIFY_TIMEOUT_MS)]),
  })
  if (!response.ok) throw new Error(`models catalog request failed (${response.status} ${response.statusText})`)
  return response.json()
}

const fetchAnthropicModels = async (access: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': access, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(VERIFY_TIMEOUT_MS)]),
  })
  if (!response.ok) throw new Error(`models catalog request failed (${response.status} ${response.statusText})`)
  return response.json()
}

const fetchLiveModels = (auth: OAuthAuth, credential: OAuthCredential, signal: AbortSignal): Promise<unknown> | null => {
  if (auth.id === 'openai') return fetchOpenAIModels(credential.access, signal)
  if (auth.id === 'anthropic') return fetchAnthropicModels(credential.access, signal)
  return null
}

export const verifyOAuthCredential = async (auth: OAuthAuth, credential: OAuthCredential, signal?: AbortSignal): Promise<VerifyResult> => {
  const fallback = signal ?? AbortSignal.timeout(VERIFY_TIMEOUT_MS)
  let effective = credential
  if (effective.expires - REFRESH_GRACE_MS <= Date.now()) {
    try {
      const fresh = await auth.refresh(effective, fallback)
      await setCredential(auth.id, fresh)
      effective = fresh
    } catch (error) {
      return { ok: false, error: `token refresh failed: ${errorMessage(error)}` }
    }
  }
  try {
    if (auth.id === 'github-copilot') {
      const raw = await fetchCopilotModelsWithCredential(effective, fallback)
      const allowPolicyFallback = getGitHubCopilotBaseUrl(effective.access, effective.enterpriseUrl) === COPILOT_INDIVIDUAL_BASE_URL
      const modelIds = parseGitHubCopilotModelCatalog(raw, allowPolicyFallback)
      if (modelIds.length === 0) return { ok: false, error: 'models catalog was empty' }
      effective = { ...effective, availableModelIds: modelIds }
      await setCredential(auth.id, effective)
      return { ok: true, modelCount: modelIds.length, credential: effective, modelIds }
    }
    const pending = fetchLiveModels(auth, effective, fallback)
    if (pending === null) {
      const stored = effective.availableModelIds
      if (stored !== undefined) return { ok: true, modelCount: stored.length, credential: effective, modelIds: stored }
      return { ok: true, modelCount: 0, credential: effective, modelIds: [] }
    }
    const modelIds = modelIdsFromStandardCatalog(await pending)
    if (modelIds.length === 0) return { ok: false, error: 'models catalog was empty' }
    effective = { ...effective, availableModelIds: modelIds }
    await setCredential(auth.id, effective)
    return { ok: true, modelCount: modelIds.length, credential: effective, modelIds }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export const confirmReLogin = async (providerName: string, ask?: (question: string) => Promise<string>, tty?: boolean): Promise<boolean> => {
  const interactive = tty ?? (Boolean(input.isTTY) && Boolean(output.isTTY))
  if (!interactive) return false
  const question =
    ask ??
    (async (prompt: string): Promise<string> => {
      const rl = createInterface({ input, output })
      try {
        return await rl.question(prompt)
      } finally {
        rl.close()
      }
    })
  try {
    const answer = (await question(`"${providerName}" is already logged in and working. Log in again with another account? [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } catch {
    return false
  }
}
