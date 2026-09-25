import { anthropicOAuth } from '@auth/anthropic.ts'
import { azureOAuth } from '@auth/azure.ts'
import { digitaloceanOAuth } from '@auth/digitalocean.ts'
import { githubCopilotOAuth } from '@auth/github-copilot.ts'
import { createInteraction } from '@auth/interaction.ts'
import { kimiCodingOAuth } from '@auth/kimi-coding.ts'
import { withPreservedModels } from '@auth/oauth-models.ts'
import { openaiOAuth } from '@auth/openai.ts'
import { openrouterOAuth } from '@auth/openrouter.ts'
import { populateOAuthModels, registerOAuthProvider } from '@auth/register.ts'
import { snowflakeCortexOAuth } from '@auth/snowflake-cortex.ts'
import { getCredential, initAuth, listCredentials, setCredential } from '@auth/store.ts'
import type { AuthLoginOptions, OAuthAuth } from '@auth/types.ts'
import { xaiOAuth } from '@auth/xai.ts'
import { logDebug } from '@shared/logger.ts'

const REFRESH_GRACE_MS = 5 * 60 * 1000
export const OAUTH_AUTHS: Array<OAuthAuth> = [openaiOAuth, anthropicOAuth, githubCopilotOAuth, xaiOAuth, openrouterOAuth, kimiCodingOAuth, digitaloceanOAuth, snowflakeCortexOAuth, azureOAuth]
const PROVIDER_ALIASES: Record<string, string> = {
  copilot: 'github-copilot',
  claude: 'anthropic',
  chatgpt: 'openai',
  codex: 'openai',
  kimi: 'kimi-coding',
  snowflake: 'snowflake-cortex',
  do: 'digitalocean',
}
export const oauthAuthById = (raw: string): OAuthAuth | undefined => {
  const normalized = raw.trim().toLowerCase()
  const id = PROVIDER_ALIASES[normalized] ?? normalized
  return OAUTH_AUTHS.find((auth) => auth.id === id)
}
export interface OAuthProviderInfo {
  id: string
  name: string
  loggedIn: boolean
}
export const listOAuthProviders = (): Array<OAuthProviderInfo> =>
  OAUTH_AUTHS.map((auth) => ({
    id: auth.id,
    name: auth.name,
    loggedIn: Boolean(getCredential(auth.id)),
  }))
let activeLoginAbort: AbortController | null = null
let activeLoginTask: Promise<void> | null = null
export const parseLoginOptions = (authId: string, opts?: string): AuthLoginOptions | undefined => {
  const trimmed = opts?.trim()
  if (!trimmed) return undefined
  const extra: Record<string, string> = {}
  for (const part of trimmed.split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq > 0) extra[part.slice(0, eq).toLowerCase()] = part.slice(eq + 1)
  }
  if (authId === 'github-copilot') return { enterpriseDomain: extra.domain ?? extra.enterprise ?? trimmed }
  if (authId === 'openai') {
    const method = extra.method ?? (['headless', 'device', 'device_code', 'browser'].includes(trimmed.toLowerCase()) ? trimmed.toLowerCase() : undefined)
    return method ? { extra: { method } } : undefined
  }
  if (authId === 'snowflake-cortex') {
    const [account, role] = trimmed.split(/\s+/)
    return { account: extra.account ?? account, role: extra.role ?? role, enterpriseDomain: extra.account ?? account }
  }
  if (authId === 'azure') {
    return { resourceName: extra.resource ?? extra.resourcename ?? trimmed, enterpriseDomain: extra.resource ?? trimmed }
  }
  return { enterpriseDomain: trimmed, extra }
}
export const cancelLogin = (): void => activeLoginAbort?.abort()
export const startLogin = async (id: string, opts?: string): Promise<void> => {
  activeLoginAbort?.abort()
  const previousTask = activeLoginTask
  if (previousTask) {
    try {
      await previousTask
    } catch (error) {
      logDebug('swallowed error', { scope: 'index', error })
    }
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
      const options = parseLoginOptions(auth.id, opts)
      const credential = await auth.login(interaction, options)
      controller.signal.throwIfAborted()
      await registerOAuthProvider(auth, credential)
      controller.signal.throwIfAborted()
      console.log(`Logged in as ${auth.name} — credential saved`)
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
      await setCredential(id, withPreservedModels(fresh, credential))
    } catch (error) {
      console.warn(`Token refresh failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
export const ensureOAuthModels = async (): Promise<void> => {
  await ensureOAuthTokens()
  await initAuth()
  const credentials = listCredentials()
  for (const [id, credential] of Object.entries(credentials)) {
    if ((credential.availableModels?.length ?? 0) > 0) continue
    const auth = oauthAuthById(id)
    if (!auth) continue
    try {
      await populateOAuthModels(auth, credential, { signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      console.warn(`Model catalog refresh failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
