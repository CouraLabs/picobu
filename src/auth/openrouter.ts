import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { oauthErrorHtml, oauthSuccessHtml } from '@auth/oauth-pages.ts'
import { generatePKCE } from '@auth/pkce.ts'
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const AUTHORIZE_URL = 'https://openrouter.ai/auth'
const TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const EXCHANGE_TIMEOUT_MS = 30_000

const callbackHost = (): string => process.env.PICOBU_OAUTH_CALLBACK_HOST || '127.0.0.1'

async function exchangeCode(code: string, verifier: string, signal: AbortSignal): Promise<OAuthCredential> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('OpenRouter exchange timed out')), EXCHANGE_TIMEOUT_MS)
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: controller.signal,
    })
    const body = (await response.json().catch(() => ({}))) as { key?: unknown; message?: unknown; error?: unknown }
    if (!response.ok) throw new Error(`OpenRouter key exchange failed (${response.status})`)
    if (typeof body.key !== 'string' || body.key.length === 0) throw new Error('OpenRouter response carries no key')
    return { type: 'oauth', access: body.key, refresh: '', expires: Number.MAX_SAFE_INTEGER }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

async function loginOpenRouter(interaction: AuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE()
  const callbackPath = `/oauth/callback/${randomUUID()}`
  let resolveCredential: (value: OAuthCredential | null) => void = () => {}
  let rejectCredential: (error: Error) => void = () => {}
  const credentialPromise = new Promise<OAuthCredential | null>((resolve, reject) => {
    resolveCredential = resolve
    rejectCredential = reject
  })
  let settled = false
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== callbackPath) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(oauthErrorHtml('Callback route not found.'))
          return
        }
        const code = url.searchParams.get('code')
        if (!code) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(oauthErrorHtml('OpenRouter returned no authorization code.'))
          return
        }
        try {
          const credential = await exchangeCode(code, verifier, interaction.signal)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(oauthSuccessHtml('Signed in to OpenRouter. You may now close this page.'))
          if (!settled) {
            settled = true
            resolveCredential(credential)
          }
        } catch (error) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(oauthErrorHtml('OpenRouter key exchange failed.'))
          if (!settled) {
            settled = true
            rejectCredential(error instanceof Error ? error : new Error(String(error)))
          }
        }
      } catch {
        res.statusCode = 500
        res.end(oauthErrorHtml('Internal error.'))
      }
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, callbackHost(), () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not determine OpenRouter callback port')
  }
  const callbackUrl = `http://${callbackHost()}:${address.port}${callbackPath}`
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true
      rejectCredential(new Error('OpenRouter login timed out'))
    }
  }, LOGIN_TIMEOUT_MS)
  const onAbort = () => {
    if (!settled) {
      settled = true
      rejectCredential(new Error('Login cancelled'))
    }
    server.close()
  }
  interaction.signal.addEventListener('abort', onAbort, { once: true })
  if (interaction.signal.aborted) onAbort()
  const authorizeUrl = new URL(AUTHORIZE_URL)
  authorizeUrl.search = new URLSearchParams({ callback_url: callbackUrl, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
  try {
    interaction.notify({ type: 'auth_url', url: authorizeUrl.toString(), instructions: 'Complete sign-in in your browser to finish.' })
    const credential = await credentialPromise
    if (!credential) throw new Error('Login cancelled')
    return credential
  } finally {
    clearTimeout(timeout)
    interaction.signal.removeEventListener('abort', onAbort)
    server.close()
  }
}

export const openrouterOAuth: OAuthAuth = {
  id: 'openrouter',
  name: 'OpenRouter',
  login: loginOpenRouter,
  refresh: (credential) => Promise.resolve(credential),
  toAuth: (credential) => ({ apiKey: credential.access }),
}
