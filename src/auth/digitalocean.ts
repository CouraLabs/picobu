import { randomBytes } from 'node:crypto'
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const CLIENT_ID = 'b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82'
const AUTHORIZE_URL = 'https://cloud.digitalocean.com/v1/oauth/authorize'
const PORT = 1456
const REDIRECT_PATH = '/auth/callback'
const TOKEN_PATH = '/auth/token'
const SCOPES = 'genai:read inference:query'
export const DIGITALOCEAN_INFERENCE_BASE_URL = 'https://inference.do-ai.run/v1'

const redirectUri = (): string => `http://localhost:${PORT}${REDIRECT_PATH}`
const createState = (): string => randomBytes(32).toString('hex')

const bootstrapHtml = (): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>DigitalOcean login</title></head>
<body>
<p id="status">Completing DigitalOcean login…</p>
<script>
(function () {
  var hash = window.location.hash.replace(/^#/, '');
  var params = new URLSearchParams(hash);
  var payload = {
    access_token: params.get('access_token'),
    expires_in: Number(params.get('expires_in')) || undefined,
    state: params.get('state'),
    error: params.get('error'),
    error_description: params.get('error_description'),
  };
  fetch('${TOKEN_PATH}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function (res) { return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; }); })
    .then(function (result) {
      document.getElementById('status').textContent = result.ok ? 'Signed in to DigitalOcean. You may now close this page.' : 'Login failed: ' + JSON.stringify(result.body);
    })
    .catch(function (error) {
      document.getElementById('status').textContent = 'Login failed: ' + String(error && error.message || error);
    });
})();
</script>
</body>
</html>`

async function loginDigitalOcean(interaction: AuthInteraction): Promise<OAuthCredential> {
  const state = createState()
  let resolveToken: (value: { access: string; expires: number }) => void = () => {}
  let rejectToken: (error: Error) => void = () => {}
  const tokenPromise = new Promise<{ access: string; expires: number }>((resolve, reject) => {
    resolveToken = resolve
    rejectToken = reject
  })
  let pending = true
  const server = Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(request) {
      try {
        const url = new URL(request.url)
        if (request.method === 'GET' && url.pathname === REDIRECT_PATH) {
          return new Response(bootstrapHtml(), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        }
        if (request.method === 'POST' && url.pathname === TOKEN_PATH) {
          let body: { access_token?: unknown; expires_in?: unknown; state?: unknown; error?: unknown; error_description?: unknown }
          try {
            body = (await request.json()) as { access_token?: unknown; expires_in?: unknown; state?: unknown; error?: unknown }
          } catch (error) {
            pending = false
            rejectToken(error instanceof Error ? error : new Error(String(error)))
            return Response.json({ error: 'bad_request' }, { status: 400 })
          }
          if (typeof body.error === 'string' && body.error) {
            pending = false
            rejectToken(new Error(typeof body.error_description === 'string' && body.error_description ? body.error_description : body.error))
            return Response.json({ ok: true })
          }
          if (typeof body.access_token !== 'string' || body.state !== state) {
            pending = false
            rejectToken(new Error('Invalid DigitalOcean callback payload'))
            return Response.json({ error: 'invalid_callback' }, { status: 400 })
          }
          const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 60 * 60 * 24 * 30
          pending = false
          resolveToken({ access: body.access_token, expires: Date.now() + expiresIn * 1000 })
          return Response.json({ ok: true })
        }
        return new Response('Not found', { status: 404 })
      } catch {
        return new Response('Internal error', { status: 500 })
      }
    },
    error() {
      return new Response('error', { status: 500 })
    },
  })
  const timeout = setTimeout(
    () => {
      if (pending) {
        pending = false
        rejectToken(new Error('DigitalOcean login timed out'))
      }
    },
    5 * 60 * 1000,
  )
  try {
    const params = new URLSearchParams({ response_type: 'token', client_id: CLIENT_ID, redirect_uri: redirectUri(), scope: SCOPES, state })
    const url = `${AUTHORIZE_URL}?${params.toString()}`
    interaction.notify({ type: 'auth_url', url, instructions: 'Sign in to DigitalOcean in your browser to finish.' })
    const token = await tokenPromise
    return { type: 'oauth', access: token.access, refresh: token.access, expires: token.expires }
  } finally {
    clearTimeout(timeout)
    server.stop()
  }
}

export const digitaloceanOAuth: OAuthAuth = {
  id: 'digitalocean',
  name: 'DigitalOcean',
  login: loginDigitalOcean,
  refresh: (credential) => Promise.resolve(credential),
  toAuth: (credential) => ({ apiKey: credential.access, baseUrl: DIGITALOCEAN_INFERENCE_BASE_URL }),
}
