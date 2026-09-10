import { anthropicOAuth } from '@auth/anthropic.ts'
import { githubCopilotOAuth } from '@auth/github-copilot.ts'
import { createInteraction } from '@auth/interaction.ts'
import { openaiOAuth } from '@auth/openai.ts'
import { registerOAuthProvider } from '@auth/register.ts'
import { getCredential, initAuth, listCredentials, setCredential } from '@auth/store.ts'
import type { OAuthAuth } from '@auth/types.ts'

const REFRESH_GRACE_MS = 5 * 60 * 1000
export const OAUTH_AUTHS: OAuthAuth[] = [openaiOAuth, anthropicOAuth, githubCopilotOAuth]
const PROVIDER_ALIASES: Record<string, string> = { copilot: 'github-copilot', claude: 'anthropic', chatgpt: 'openai' }
export const oauthAuthById = (raw: string): OAuthAuth | undefined => {
  const normalized = raw.trim().toLowerCase()
  const id = PROVIDER_ALIASES[normalized] ?? normalized
  return OAUTH_AUTHS.find((auth) => auth.id === id)
}
export type OAuthProviderInfo = { id: string; name: string; loggedIn: boolean }
export const listOAuthProviders = (): OAuthProviderInfo[] =>
  OAUTH_AUTHS.map((auth) => ({
    id: auth.id,
    name: auth.name,
    loggedIn: Boolean(getCredential(auth.id)),
  }))
let activeLoginAbort: AbortController | null = null
let activeLoginTask: Promise<void> | null = null
export const cancelLogin = (): void => activeLoginAbort?.abort()
export const startLogin = async (id: string, opts?: string): Promise<void> => {
  activeLoginAbort?.abort()
  const previousTask = activeLoginTask
  if (previousTask) {
    try {
      await previousTask
    } catch {}
  }
  const auth = oauthAuthById(id)
  if (!auth) {
    console.error(`Unknown OAuth provider "${id}"`)
    return
  }
  const controller = new AbortController()
  activeLoginAbort = controller
  const task = (async (): Promise<void> => {
    try {
      const interaction = createInteraction(auth.id, auth.name, controller.signal)
      const options = opts?.trim() ? { enterpriseDomain: opts.trim() } : undefined
      const credential = await auth.login(interaction, options)
      controller.signal.throwIfAborted()
      await registerOAuthProvider(auth, credential)
      controller.signal.throwIfAborted()
      console.log(`Logged in as ${auth.name} — provider & models registered`)
    } catch (error) {
      console.error(`Login failed for ${auth.id}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (activeLoginAbort === controller) activeLoginAbort = null
    }
  })()
  activeLoginTask = task
  try {
    await task
  } finally {
    if (activeLoginTask === task) activeLoginTask = null
  }
}
let refreshInFlight: Promise<void> | null = null
export const ensureOAuthTokens = (): Promise<void> => {
  refreshInFlight ??= refreshOAuthTokens().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}
export const refreshOAuthTokens = async (): Promise<void> => {
  await initAuth()
  const credentials = listCredentials()
  for (const [id, credential] of Object.entries(credentials)) {
    if (credential.expires - REFRESH_GRACE_MS > Date.now()) continue
    const auth = oauthAuthById(id)
    if (!auth) continue
    try {
      const fresh = await auth.refresh(credential, AbortSignal.timeout(60_000))
      if (fresh.expires - REFRESH_GRACE_MS <= Date.now()) continue
      await setCredential(id, fresh)
    } catch (error) {
      console.warn(`Token refresh failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
