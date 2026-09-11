import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { oauthErrorHtml, oauthSuccessHtml } from '@auth/oauth-pages.ts'
import { generatePKCE } from '@auth/pkce.ts'
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const decode = (s: string): string => atob(s)
const CLIENT_ID = decode('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl')
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CALLBACK_PORT = 53692
const CALLBACK_PATH = '/callback'
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`
const SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers ' + 'user:file_upload'
const callbackHost = (): string => process.env.PICOBU_OAUTH_CALLBACK_HOST || '127.0.0.1'
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const createOAuthState = (): string => randomBytes(16).toString('hex')
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
interface CallbackServerInfo {
  server: Server
  cancelWait: () => void
  waitForCode: () => Promise<{ code: string } | null>
}
function startCallbackServer(expectedState: string): Promise<CallbackServerInfo> {
  return new Promise((resolve, reject) => {
    let settleWait: ((value: { code: string } | null) => void) | undefined
    const waitForCodePromise = new Promise<{ code: string } | null>((resolveWait) => {
      let settled = false
      settleWait = (value) => {
        if (settled) return
        settled = true
        resolveWait(value)
      }
    })
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url || '', 'http://localhost')
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthErrorHtml('Callback route not found.'))
          return
        }
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthErrorHtml('Anthropic authentication did not complete.', `Error: ${error}`))
          settleWait?.(null)
          return
        }
        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthErrorHtml('Missing code or state parameter.'))
          settleWait?.(null)
          return
        }
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(oauthErrorHtml('State mismatch.'))
          settleWait?.(null)
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthSuccessHtml('Anthropic authentication completed. You can close this window.'))
        settleWait?.({ code })
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal error')
      }
    })
    server.on('error', (err) => {
      reject(err)
    })
    server.listen(CALLBACK_PORT, callbackHost(), () => {
      resolve({
        server,
        cancelWait: () => {
          settleWait?.(null)
        },
        waitForCode: () => waitForCodePromise,
      })
    })
  })
}
const formatErrorDetails = (error: unknown): string => {
  if (error instanceof Error) {
    const details = [`${error.name}: ${error.message}`]
    const err = error as Error & { code?: string; errno?: number | string; cause?: unknown }
    if (err.code) details.push(`code=${err.code}`)
    if (typeof err.errno !== 'undefined') details.push(`errno=${String(err.errno)}`)
    if (typeof err.cause !== 'undefined') details.push(`cause=${formatErrorDetails(err.cause)}`)
    return details.join('; ')
  }
  return String(error)
}
async function postJson(url: string, body: Record<string, string | number>, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  })
  const responseBody = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP request failed. status=${response.status}; url=${url}; body=${responseBody}`)
  }
  return responseBody
}
interface AnthropicToken {
  access_token: string
  refresh_token: string
  expires_in: number
}
const validateAnthropicToken = (json: unknown, url: string, body: string): AnthropicToken => {
  const record = json as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null
  if (!record || typeof record.access_token !== 'string' || typeof record.refresh_token !== 'string' || typeof record.expires_in !== 'number') {
    throw new Error(`Token response missing fields. url=${url}; body=${body}`)
  }
  return { access_token: record.access_token, refresh_token: record.refresh_token, expires_in: record.expires_in }
}
async function exchangeAuthorizationCode(code: string, verifier: string, redirectUri: string, signal: AbortSignal): Promise<OAuthCredential> {
  let responseBody: string
  try {
    responseBody = await postJson(
      TOKEN_URL,
      {
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      },
      signal,
    )
  } catch (error) {
    throw new Error(`Token exchange request failed. url=${TOKEN_URL}; redirect_uri=${redirectUri}; details=${formatErrorDetails(error)}`)
  }
  let tokenData: AnthropicToken
  try {
    tokenData = validateAnthropicToken(JSON.parse(responseBody), TOKEN_URL, responseBody)
  } catch (error) {
    throw new Error(`Token exchange returned invalid payload. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`)
  }
  return {
    type: 'oauth',
    refresh: tokenData.refresh_token,
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
  }
}
const tokenFromPayload = (data: unknown): OAuthCredential => {
  const token = validateAnthropicToken(data, TOKEN_URL, JSON.stringify(data))
  return {
    type: 'oauth',
    refresh: token.refresh_token,
    access: token.access_token,
    expires: Date.now() + token.expires_in * 1000 - 5 * 60 * 1000,
  }
}
async function loginAnthropic(interaction: AuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE()
  const oauthState = createOAuthState()
  const server = await startCallbackServer(oauthState)
  const onAbort = () => server.cancelWait()
  interaction.signal.addEventListener('abort', onAbort, { once: true })
  if (interaction.signal.aborted) onAbort()
  try {
    const authParams = new URLSearchParams({
      code: 'true',
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: oauthState,
    })
    interaction.notify({
      type: 'auth_url',
      url: `${AUTHORIZE_URL}?${authParams.toString()}`,
      instructions: 'A browser window should open. Complete login to finish.',
    })
    const result = await withTimeout(server.waitForCode(), LOGIN_TIMEOUT_MS, 'Login timed out — please try again')
    if (!result?.code) throw new Error('Login cancelled')
    interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens…' })
    return exchangeAuthorizationCode(result.code, verifier, REDIRECT_URI, interaction.signal)
  } finally {
    interaction.signal.removeEventListener('abort', onAbort)
    server.server.close()
  }
}
async function refreshAnthropicToken(refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> {
  let responseBody: string
  try {
    responseBody = await postJson(TOKEN_URL, { grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken }, signal)
  } catch (error) {
    throw new Error(`Anthropic token refresh request failed. url=${TOKEN_URL}; details=${formatErrorDetails(error)}`)
  }
  let data: unknown
  try {
    data = JSON.parse(responseBody)
  } catch (error) {
    throw new Error(`Anthropic token refresh returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`)
  }
  try {
    return tokenFromPayload(data)
  } catch (error) {
    throw new Error(`Anthropic token refresh response missing fields. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`)
  }
}
export const anthropicOAuth: OAuthAuth = {
  id: 'anthropic',
  name: 'Anthropic',
  login: loginAnthropic,
  refresh: (credential, signal) => refreshAnthropicToken(credential.refresh, signal),
  toAuth: (credential) => ({ apiKey: credential.access }),
}
