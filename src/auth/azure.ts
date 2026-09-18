import { execFile } from 'node:child_process'
import type { AuthInteraction, AuthLoginOptions, OAuthAuth, OAuthCredential } from '@auth/types.ts'

const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default'
const AZ_CLI_REFRESH_PLACEHOLDER = 'az-cli'

export interface AzToken {
  token: string
  expires: number
}

export type AzTokenFetcher = (scope: string) => Promise<AzToken>

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

async function azAccessToken(scope: string): Promise<AzToken> {
  const raw = (await runAz(['account', 'get-access-token', '--scope', scope, '--output', 'json'])) as { accessToken?: unknown; expires_on?: unknown; expiresOn?: unknown }
  if (typeof raw.accessToken !== 'string' || !raw.accessToken) throw new Error('Azure CLI returned no access token — run `az login` first')
  const expires = typeof raw.expires_on === 'number' ? raw.expires_on * 1000 : Date.parse(typeof raw.expiresOn === 'string' ? raw.expiresOn : '')
  if (!Number.isFinite(expires)) throw new Error('Azure CLI returned an invalid token expiration')
  return { token: raw.accessToken, expires }
}

let tokenFetcher: AzTokenFetcher = azAccessToken
export const setAzTokenFetcherForTests = (next: AzTokenFetcher | undefined): void => {
  tokenFetcher = next ?? azAccessToken
}

const credentialFromToken = (token: AzToken, accountId?: string): OAuthCredential => ({
  type: 'oauth',
  access: token.token,
  refresh: AZ_CLI_REFRESH_PLACEHOLDER,
  expires: token.expires,
  ...(accountId ? { accountId } : {}),
})

async function loginAzure(interaction: AuthInteraction, options?: AuthLoginOptions): Promise<OAuthCredential> {
  const resourceName = options?.resourceName?.trim() || options?.enterpriseDomain?.trim() || process.env.AZURE_RESOURCE_NAME?.trim()
  if (!resourceName) throw new Error('Azure resource name is required — run: picobu login azure <resource-name>')
  interaction.notify({ type: 'progress', message: 'Checking `az login` session…' })
  const token = await tokenFetcher(COGNITIVE_SCOPE)
  if (!token.token) throw new Error('Azure CLI returned an empty access token — run `az login` first')
  return credentialFromToken(token, resourceName)
}

export const azureOAuth: OAuthAuth = {
  id: 'azure',
  name: 'Azure',
  login: loginAzure,
  refresh: async (credential) => {
    const token = await tokenFetcher(COGNITIVE_SCOPE)
    if (!token.token) throw new Error('Azure CLI returned an empty access token — run `az login` first')
    return credentialFromToken(token, credential.accountId)
  },
  toAuth: (credential) => ({ apiKey: credential.access, baseUrl: credential.accountId ? `https://${credential.accountId}.openai.azure.com` : undefined }),
}
