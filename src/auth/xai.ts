import { pollOAuthDeviceCodeFlow } from '@auth/device-code.ts'
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const DEVICE_AUTHORIZATION_URL = 'https://auth.x.ai/oauth2/device/code'
const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const SCOPE = 'openid profile email offline_access grok-cli:access api:access'
const DEVICE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000
const REFRESH_SKEW_MS = 2 * 60 * 1000

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  expires_in?: number
}

const authHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
  'User-Agent': 'picobu',
})

export const requestXaiDeviceCode = async (
  signal: AbortSignal,
): Promise<{ deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; intervalSeconds?: number; expiresInSeconds: number }> => {
  const response = await fetch(DEVICE_AUTHORIZATION_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, referrer: 'picobu' }).toString(),
    signal,
  })
  if (!response.ok) throw new Error(`xAI device code request failed (${response.status})`)
  const body = (await response.json()) as Record<string, unknown>
  const deviceCode = body.device_code
  const userCode = body.user_code
  const verificationUri = body.verification_uri
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    throw new Error('Invalid xAI device code response')
  }
  const parsed = new URL(verificationUri)
  if (parsed.protocol !== 'https:') throw new Error('Untrusted verification URI in xAI response')
  const completeRaw = typeof body.verification_uri_complete === 'string' ? body.verification_uri_complete : undefined
  let complete: string | undefined
  if (completeRaw !== undefined) {
    const parsedComplete = new URL(completeRaw)
    if (parsedComplete.protocol !== 'https:') throw new Error('Untrusted verification URI in xAI response')
    complete = parsedComplete.href
  }
  return {
    deviceCode,
    userCode,
    verificationUri: parsed.href,
    verificationUriComplete: complete,
    intervalSeconds: typeof body.interval === 'number' && body.interval > 0 ? body.interval : undefined,
    expiresInSeconds: typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : DEVICE_DEFAULT_EXPIRES_MS / 1000,
  }
}

const credentialsFromToken = (body: TokenResponse, previousRefresh?: string): OAuthCredential => {
  const refresh = body.refresh_token || previousRefresh
  if (!refresh) throw new Error('xAI token response missing refresh_token')
  return {
    type: 'oauth',
    access: body.access_token,
    refresh,
    expires: Date.now() + (body.expires_in ?? 3600) * 1000 - REFRESH_SKEW_MS,
  }
}

const pollXaiToken = (deviceCode: string, intervalSeconds: number | undefined, expiresInSeconds: number, signal: AbortSignal): Promise<OAuthCredential> =>
  pollOAuthDeviceCodeFlow<OAuthCredential>({
    intervalSeconds,
    expiresInSeconds,
    waitBeforeFirstPoll: true,
    signal,
    poll: async () => {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: authHeaders(),
        body: new URLSearchParams({ grant_type: DEVICE_CODE_GRANT_TYPE, client_id: CLIENT_ID, device_code: deviceCode }).toString(),
        signal,
      })
      if (response.ok) {
        const body = (await response.json()) as TokenResponse
        return { status: 'complete', value: credentialsFromToken(body) }
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; error_description?: string; interval?: number }
      if (data.error === 'authorization_pending') return { status: 'pending' }
      if (data.error === 'slow_down') return { status: 'slow_down', intervalSeconds: typeof data.interval === 'number' ? data.interval : undefined }
      if (data.error === 'access_denied' || data.error === 'authorization_denied') return { status: 'failed', message: 'xAI device authorization was denied' }
      if (data.error === 'expired_token') return { status: 'failed', message: 'xAI device code expired — please re-run login' }
      return { status: 'failed', message: `xAI device token exchange failed (${response.status})` }
    },
  })

const refreshXaiToken = async (refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }).toString(),
    signal,
  })
  if (!response.ok) throw new Error(`xAI token refresh failed (${response.status})`)
  return credentialsFromToken((await response.json()) as TokenResponse, refreshToken)
}

async function loginXai(interaction: AuthInteraction): Promise<OAuthCredential> {
  const device = await requestXaiDeviceCode(interaction.signal)
  interaction.notify({
    type: 'device_code',
    userCode: device.userCode,
    verificationUri: device.verificationUriComplete ?? device.verificationUri,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
  })
  return pollXaiToken(device.deviceCode, device.intervalSeconds, device.expiresInSeconds, interaction.signal)
}

export const xaiOAuth: OAuthAuth = {
  id: 'xai',
  name: 'xAI',
  login: loginXai,
  refresh: (credential, signal) => refreshXaiToken(credential.refresh, signal),
  toAuth: (credential) => ({ apiKey: credential.access }),
}
