import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { oauthErrorHtml, oauthSuccessHtml } from '@auth/oauth-pages.ts'
import { generatePKCE } from '@auth/pkce.ts'
import type { AuthInteraction, AuthLoginOptions, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const CLIENT_ID = 'LOCAL_APPLICATION'
const CALLBACK_HOST = '127.0.0.1'
const TIMEOUT_MS = 5 * 60 * 1000

export const normalizeSnowflakeAccount = (input: string): string | null => {
  const trimmed = input.trim()
  if (!trimmed) return null
  return (
    trimmed
      .replace(/^https?:\/\//, '')
      .replace(/\.snowflakecomputing\.com\/?$/, '')
      .replace(/\/+$/, '') || null
  )
}

export const snowflakeScope = (role: string | undefined): string => {
  if (!role) return 'refresh_token'
  return /^[-_A-Za-z0-9]+$/.test(role) ? `refresh_token session:role:${role}` : `refresh_token session:role-encoded:${encodeURIComponent(role)}`
}

async function exchangeCode(account: string, code: string, verifier: string, redirectUri: string, signal: AbortSignal): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const response = await fetch(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_ID}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: CLIENT_ID, code_verifier: verifier }).toString(),
    signal,
  })
  if (!response.ok) throw new Error(`Snowflake token exchange failed (${response.status})`)
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
}

async function refreshToken(account: string, refresh: string, signal: AbortSignal): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const response = await fetch(`https://${account}.snowflakecomputing.com/oauth/token-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_ID}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLIENT_ID }).toString(),
    signal,
  })
  if (!response.ok) throw new Error(`Snowflake token refresh failed (${response.status})`)
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
}

async function loginSnowflake(interaction: AuthInteraction, options?: AuthLoginOptions): Promise<OAuthCredential> {
  const accountInput = options?.account?.trim() || options?.enterpriseDomain?.trim() || ''
  const account = normalizeSnowflakeAccount(accountInput)
  if (!account) throw new Error('Snowflake account is required — run: picobu login snowflake-cortex <account> [role]')
  const role = options?.role?.trim() || undefined
  const { verifier, challenge } = await generatePKCE()
  const state = randomBytes(32).toString('hex')
  let resolveCode: (code: string) => void = () => {}
  let rejectCode: (error: Error) => void = () => {}
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== '/') {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthErrorHtml('State mismatch.'))
        rejectCode(new Error('State mismatch'))
        server.close()
        return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthErrorHtml('Snowflake authentication did not complete.'))
        rejectCode(new Error(String(error)))
        server.close()
        return
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthErrorHtml('Missing authorization code.'))
        rejectCode(new Error('Missing authorization code'))
        server.close()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(oauthSuccessHtml('Snowflake authentication completed. You can close this window.'))
      resolveCode(code)
    } catch {
      res.writeHead(500)
      res.end('Internal error')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, CALLBACK_HOST, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not determine Snowflake callback port')
  }
  const redirectUri = `http://${CALLBACK_HOST}:${address.port}/`
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: snowflakeScope(role),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const url = `https://${account}.snowflakecomputing.com/oauth/authorize?${params.toString()}`
  const timeout = setTimeout(() => rejectCode(new Error('Snowflake login timed out')), TIMEOUT_MS)
  try {
    interaction.notify({ type: 'auth_url', url, instructions: 'Complete Snowflake sign-in in your browser to finish.' })
    const code = await codePromise
    const tokens = await exchangeCode(account, code, verifier, redirectUri, interaction.signal)
    if (!tokens.refresh_token) throw new Error('Snowflake did not issue a refresh_token — ensure scope includes refresh_token')
    return { type: 'oauth', access: tokens.access_token, refresh: tokens.refresh_token, expires: Date.now() + (tokens.expires_in ?? 600) * 1000, accountId: account }
  } finally {
    clearTimeout(timeout)
    server.close()
  }
}

export const snowflakeCortexOAuth: OAuthAuth = {
  id: 'snowflake-cortex',
  name: 'Snowflake Cortex',
  login: loginSnowflake,
  refresh: async (credential, signal) => {
    if (!credential.accountId) throw new Error('Snowflake auth is missing accountId')
    const tokens = await refreshToken(credential.accountId, credential.refresh, signal)
    return { type: 'oauth', access: tokens.access_token, refresh: tokens.refresh_token || credential.refresh, expires: Date.now() + (tokens.expires_in ?? 600) * 1000, accountId: credential.accountId }
  },
  toAuth: (credential) => ({ apiKey: credential.access, baseUrl: credential.accountId ? `https://${credential.accountId}.snowflakecomputing.com/api/v2/cortex/v1` : undefined }),
}
