import { execFile } from 'node:child_process'
import type { AuthInteraction, AuthLoginOptions, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const DUMMY_KEY = 'picobu-azure-oauth-dummy-key'
const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default'

const runAz = (args: Array<string>): Promise<unknown> =>
  new Promise((resolve, reject) => {
    execFile('az', args, { timeout: 30_000 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })

async function azAccessToken(scope: string): Promise<{ token: string; expires: number }> {
  const raw = (await runAz(['account', 'get-access-token', '--scope', scope, '--output', 'json'])) as { accessToken?: unknown; expires_on?: unknown; expiresOn?: unknown }
  if (typeof raw.accessToken !== 'string' || !raw.accessToken) throw new Error('Azure CLI returned no access token — run `az login` first')
  const expires = typeof raw.expires_on === 'number' ? raw.expires_on * 1000 : Date.parse(typeof raw.expiresOn === 'string' ? raw.expiresOn : '')
  if (!Number.isFinite(expires)) throw new Error('Azure CLI returned an invalid token expiration')
  return { token: raw.accessToken, expires }
}

async function loginAzure(interaction: AuthInteraction, options?: AuthLoginOptions): Promise<OAuthCredential> {
  const resourceName = options?.resourceName?.trim() || options?.enterpriseDomain?.trim() || process.env.AZURE_RESOURCE_NAME?.trim()
  if (!resourceName) throw new Error('Azure resource name is required — run: picobu login azure <resource-name>')
  interaction.notify({ type: 'progress', message: 'Checking `az login` session…' })
  await azAccessToken(COGNITIVE_SCOPE)
  return { type: 'oauth', access: DUMMY_KEY, refresh: DUMMY_KEY, expires: Date.now() + 365 * 24 * 60 * 60 * 1000, accountId: resourceName }
}

export const azureOAuth: OAuthAuth = {
  id: 'azure',
  name: 'Azure',
  login: loginAzure,
  refresh: (credential) => Promise.resolve(credential),
  toAuth: (credential) => ({ apiKey: DUMMY_KEY, baseUrl: credential.accountId ? `https://${credential.accountId}.openai.azure.com` : undefined }),
}
