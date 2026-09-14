import { abortableSleep, pollOAuthDeviceCodeFlow } from '@auth/device-code.ts'
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'
const DEFAULT_OAUTH_HOST = 'https://auth.kimi.com'
const DEVICE_TIMEOUT_S = 15 * 60
const DEFAULT_INTERVAL_S = 5
const REQUEST_TIMEOUT_MS = 30 * 1000
const REFRESH_MAX_RETRIES = 3
export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding'

const oauthHost = (): string => {
  const override = process.env.KIMI_CODE_OAUTH_HOST || process.env.KIMI_OAUTH_HOST
  return (override || DEFAULT_OAUTH_HOST).replace(/\/+$/, '')
}

const withTimeout = (signal: AbortSignal): AbortSignal => AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal])

const readJson = async (response: Response): Promise<Record<string, unknown> | null> => {
  try {
    const json = await response.json()
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const parseToken = (json: Record<string, unknown> | null, operation: string): OAuthCredential => {
  const access = json?.access_token
  const refresh = json?.refresh_token
  const expiresIn = json?.expires_in
  if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error(`Kimi token ${operation} response missing fields`)
  }
  return { type: 'oauth', access, refresh, expires: Date.now() + expiresIn * 1000 }
}

async function loginKimi(interaction: AuthInteraction): Promise<OAuthCredential> {
  const host = oauthHost()
  const start = await fetch(`${host}/api/oauth/device_authorization`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLIENT_ID }).toString(),
    signal: withTimeout(interaction.signal),
  })
  if (!start.ok) throw new Error(`Kimi device authorization failed (${start.status})`)
  const data = await readJson(start)
  const deviceCode = data?.device_code
  const userCode = data?.user_code
  const verificationUri = data?.verification_uri_complete ?? data?.verification_uri
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    throw new Error('Invalid Kimi device authorization response')
  }
  const uri = new URL(verificationUri)
  if (uri.protocol !== 'https:' && uri.protocol !== 'http:') throw new Error('Untrusted verification URI in Kimi response')
  const interval = typeof data?.interval === 'number' && data.interval > 0 ? data.interval : DEFAULT_INTERVAL_S
  const expiresIn = typeof data?.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : DEVICE_TIMEOUT_S
  interaction.notify({ type: 'device_code', userCode, verificationUri: uri.href, intervalSeconds: interval, expiresInSeconds: expiresIn })
  return pollOAuthDeviceCodeFlow<OAuthCredential>({
    intervalSeconds: interval,
    expiresInSeconds: expiresIn,
    waitBeforeFirstPoll: true,
    signal: interaction.signal,
    poll: async () => {
      const response = await fetch(`${host}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: CLIENT_ID, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString(),
        signal: withTimeout(interaction.signal),
      })
      if (response.status >= 500) return { status: 'failed', message: `Kimi device token request failed (${response.status})` }
      const json = await readJson(response)
      if (response.ok && typeof json?.access_token === 'string') {
        try {
          return { status: 'complete', value: parseToken(json, 'poll') }
        } catch (error) {
          return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
        }
      }
      if (json?.error === 'authorization_pending') return { status: 'pending' }
      if (json?.error === 'slow_down') return { status: 'slow_down', intervalSeconds: typeof json.interval === 'number' ? json.interval : undefined }
      if (json?.error === 'expired_token') return { status: 'failed', message: 'Kimi device authorization expired — restart login' }
      if (json?.error === 'access_denied') return { status: 'failed', message: 'Kimi login was denied' }
      return { status: 'failed', message: `Kimi device token request failed (${response.status})` }
    },
  })
}

async function refreshKimi(refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> {
  const host = oauthHost()
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= REFRESH_MAX_RETRIES; attempt++) {
    if (attempt > 0) await abortableSleep(1000 * 2 ** (attempt - 1), signal, 'Kimi Code token refresh aborted')
    const response = await fetch(`${host}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      signal: withTimeout(signal),
    }).catch((error: unknown) => {
      lastError = error instanceof Error ? error : new Error(String(error))
      return undefined
    })
    if (!response) continue
    const json = await readJson(response)
    if (response.ok) return parseToken(json, 'refresh')
    if (response.status === 401 || response.status === 403 || json?.error === 'invalid_grant') throw new Error('Kimi refresh unauthorized — please re-login')
    if ((response.status === 429 || response.status >= 500) && attempt < REFRESH_MAX_RETRIES) continue
    throw new Error(`Kimi token refresh failed (${response.status})`)
  }
  throw lastError ?? new Error('Kimi token refresh failed')
}

export const kimiCodingOAuth: OAuthAuth = {
  id: 'kimi-coding',
  name: 'Kimi Coding',
  login: loginKimi,
  refresh: (credential, signal) => refreshKimi(credential.refresh, signal),
  toAuth: (credential) => ({ apiKey: credential.access, baseUrl: KIMI_CODING_BASE_URL }),
}
