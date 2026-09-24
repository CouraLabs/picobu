import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { buildCopilotModelsFromCatalog } from '@auth/copilot-models.ts'
import { fetchCopilotModelsWithCredential, getGitHubCopilotBaseUrl, parseGitHubCopilotModelCatalog } from '@auth/github-copilot.ts'
import { withPreservedModels } from '@auth/oauth-models.ts'
import { oauthProviderCatalogSupported, populateOAuthModels } from '@auth/register.ts'
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

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const verifyOAuthCredential = async (auth: OAuthAuth, credential: OAuthCredential, signal?: AbortSignal): Promise<VerifyResult> => {
  const fallback = signal ?? AbortSignal.timeout(VERIFY_TIMEOUT_MS)
  let effective = credential
  if (effective.expires - REFRESH_GRACE_MS <= Date.now()) {
    try {
      const fresh = await auth.refresh(effective, fallback)
      const merged = withPreservedModels(fresh, effective)
      await setCredential(auth.id, merged)
      effective = merged
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
      const availableModels = buildCopilotModelsFromCatalog(raw, allowPolicyFallback)
      effective = { ...effective, availableModelIds: modelIds, availableModels }
      await setCredential(auth.id, effective)
      return { ok: true, modelCount: modelIds.length, credential: effective, modelIds }
    }
    const stored = effective.availableModelIds
    if (!oauthProviderCatalogSupported(auth.id)) {
      if (stored !== undefined) return { ok: true, modelCount: stored.length, credential: effective, modelIds: stored }
      return { ok: true, modelCount: 0, credential: effective, modelIds: [] }
    }
    const populated = await populateOAuthModels(auth, effective, { signal: fallback })
    if (populated.modelIds.length === 0) return { ok: false, error: 'models catalog was empty' }
    return { ok: true, modelCount: populated.modelIds.length, credential: populated.credential, modelIds: populated.modelIds }
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
