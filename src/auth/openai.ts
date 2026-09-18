import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { pollOAuthDeviceCodeFlow } from '@auth/device-code.ts'
import { oauthErrorHtml, oauthSuccessHtml } from '@auth/oauth-pages.ts'
import { generatePKCE } from '@auth/pkce.ts'
import { describeTokenPayload } from '@auth/redact.ts'
import type { AuthInteraction, AuthLoginOptions, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_BASE_URL = 'https://auth.openai.com'
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`
const DEVICE_TIMEOUT_S = 15 * 60
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
const SCOPE = 'openid profile email offline_access'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'
interface OAuthToken {
  access: string
  refresh: string
  expires: number
}
type TokenOperation = 'exchange' | 'refresh'
export interface JwtPayload {
  [JWT_CLAIM_PATH]?: { chatgpt_account_id?: string }
  [key: string]: unknown
}
const CALLBACK_PORT = 1455
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const callbackHost = (): string => process.env.PICOBU_OAUTH_CALLBACK_HOST || '127.0.0.1'
const createState = (): string => randomBytes(16).toString('hex')
const withTimeout = async <TValue>(promise: Promise<TValue>, ms: number, message: string): Promise<TValue> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
export const decodeJwt = (token: string): JwtPayload | null => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1] ?? ''
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as JwtPayload
  } catch {
    return null
  }
}
export const getAccountId = (accessToken: string): string | null => {
  const payload = decodeJwt(accessToken)
  const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
}
async function fetchWithLoginCancellation(input: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (init.signal?.aborted) throw new Error('Login cancelled')
    throw error
  }
}
async function readTokenResponse(response: Response, operation: TokenOperation): Promise<OAuthToken> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI token ${operation} failed (${response.status}): ${text || response.statusText}`)
  }
  const json = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  } | null
  if (!json?.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error(`OpenAI token ${operation} response missing fields: ${describeTokenPayload(json)}`)
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}
async function exchangeAuthorizationCode(code: string, verifier: string, signal: AbortSignal, redirectUri: string = REDIRECT_URI): Promise<OAuthToken> {
  const response = await fetchWithLoginCancellation(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
    signal,
  })
  return readTokenResponse(response, 'exchange')
}
async function refreshAccessToken(refreshToken: string, signal: AbortSignal): Promise<OAuthToken> {
  const response = await fetchWithLoginCancellation(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
    signal,
  })
  return readTokenResponse(response, 'refresh')
}
interface CallbackServerInfo {
  port: number
  close: () => void
  cancelWait: () => void
  waitForCode: () => Promise<{ code: string } | null>
}
function startLocalOAuthServer(state: string): Promise<CallbackServerInfo> {
  let settleWait: ((value: { code: string } | null) => void) | undefined
  const waitForCodePromise = new Promise<{ code: string } | null>((resolve) => {
    let settled = false
    settleWait = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
  })
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '', 'http://localhost')
      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(oauthErrorHtml('Callback route not found.'))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(oauthErrorHtml('OpenAI authentication did not complete.', `Error: ${error}`))
        settleWait?.(null)
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(oauthErrorHtml('State mismatch.'))
        settleWait?.(null)
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(oauthErrorHtml('Missing authorization code.'))
        settleWait?.(null)
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(oauthSuccessHtml('OpenAI authentication completed. You can close this window.'))
      settleWait?.({ code })
    } catch {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(oauthErrorHtml('Internal error while processing OAuth callback.'))
    }
  })
  return new Promise((resolve, reject) => {
    let fallback = false
    const finish = (port: number): void => {
      resolve({
        port,
        close: () => server.close(),
        cancelWait: () => {
          settleWait?.(null)
        },
        waitForCode: () => waitForCodePromise,
      })
    }
    server
      .listen(CALLBACK_PORT, callbackHost(), () => {
        fallback = true
        finish(CALLBACK_PORT)
      })
      .on('error', (err) => {
        if (fallback) {
          reject(err)
          return
        }
        fallback = true
        server.listen(0, callbackHost(), () => {
          const address = server.address()
          finish(typeof address === 'object' && address !== null ? address.port : 0)
        })
      })
  })
}
function credentialsFromToken(token: OAuthToken): OAuthCredential {
  const accountId = getAccountId(token.access)
  if (!accountId) {
    throw new Error('Failed to extract accountId from token')
  }
  return {
    type: 'oauth',
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    accountId,
  }
}
async function createAuthorizationFlow(redirectUri: string, state: string): Promise<{ verifier: string; url: string }> {
  const { verifier, challenge } = await generatePKCE()
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'picobu')
  return { verifier, url: url.toString() }
}
async function loginOpenAI(interaction: AuthInteraction, options?: AuthLoginOptions): Promise<OAuthCredential> {
  const mode = options?.extra?.method?.trim().toLowerCase() || options?.enterpriseDomain?.trim().toLowerCase()
  if (mode === 'headless' || mode === 'device' || mode === 'device_code') return loginOpenAIDeviceCode(interaction)
  const state = createState()
  const server = await startLocalOAuthServer(state)
  const redirectUri = `http://localhost:${server.port}/auth/callback`
  const { verifier, url } = await createAuthorizationFlow(redirectUri, state)
  const onAbort = () => server.cancelWait()
  interaction.signal.addEventListener('abort', onAbort, { once: true })
  if (interaction.signal.aborted) onAbort()
  try {
    interaction.notify({
      type: 'auth_url',
      url,
      instructions: 'A browser window should open. Complete login to finish.',
    })
    const result = await withTimeout(server.waitForCode(), LOGIN_TIMEOUT_MS, 'Login timed out — please try again')
    if (!result?.code) throw new Error('Login cancelled')
    interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens…' })
    return credentialsFromToken(await exchangeAuthorizationCode(result.code, verifier, interaction.signal, redirectUri))
  } finally {
    interaction.signal.removeEventListener('abort', onAbort)
    server.close()
  }
}
const refreshOpenAICodexToken = async (refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> => credentialsFromToken(await refreshAccessToken(refreshToken, signal))

async function startOpenAIDeviceAuth(signal: AbortSignal): Promise<{ deviceAuthId: string; userCode: string; intervalSeconds: number }> {
  const response = await fetchWithLoginCancellation(DEVICE_USER_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal,
  })
  if (!response.ok) throw new Error(`OpenAI device code request failed (${response.status})`)
  const json = (await response.json()) as { device_auth_id?: string; user_code?: string; interval?: number | string } | null
  const intervalSeconds = typeof json?.interval === 'string' ? Number(json.interval.trim()) : json?.interval
  if (!json?.device_auth_id || !json.user_code || typeof intervalSeconds !== 'number' || !Number.isFinite(intervalSeconds)) {
    throw new Error('Invalid OpenAI device code response')
  }
  return { deviceAuthId: json.device_auth_id, userCode: json.user_code, intervalSeconds }
}

async function loginOpenAIDeviceCode(interaction: AuthInteraction): Promise<OAuthCredential> {
  const device = await startOpenAIDeviceAuth(interaction.signal)
  interaction.notify({ type: 'device_code', userCode: device.userCode, verificationUri: DEVICE_VERIFICATION_URI, intervalSeconds: device.intervalSeconds, expiresInSeconds: DEVICE_TIMEOUT_S })
  const token = await pollOAuthDeviceCodeFlow<{ authorizationCode: string; codeVerifier: string }>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: DEVICE_TIMEOUT_S,
    signal: interaction.signal,
    poll: async () => {
      const response = await fetchWithLoginCancellation(DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode }),
        signal: interaction.signal,
      })
      if (response.ok) {
        const json = (await response.json()) as { authorization_code?: string; code_verifier?: string } | null
        if (!json?.authorization_code || !json.code_verifier) return { status: 'failed', message: 'Invalid OpenAI device token response' }
        return { status: 'complete', value: { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier } }
      }
      if (response.status === 403 || response.status === 404) return { status: 'pending' }
      return { status: 'failed', message: `OpenAI device auth failed (${response.status})` }
    },
  })
  return credentialsFromToken(await exchangeAuthorizationCode(token.authorizationCode, token.codeVerifier, interaction.signal, DEVICE_REDIRECT_URI))
}
export const openaiOAuth: OAuthAuth = {
  id: 'openai',
  name: 'OpenAI',
  login: loginOpenAI,
  refresh: (credential, signal) => refreshOpenAICodexToken(credential.refresh, signal),
  toAuth: (credential) => ({ apiKey: credential.access }),
}
