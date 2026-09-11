export interface OAuthCredential {
  type: 'oauth'
  access: string
  refresh: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
  availableModelIds?: Array<string>
}

export type AuthNotifyEvent =
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | { type: 'progress'; message: string }

export interface AuthInteraction {
  signal: AbortSignal
  notify: (event: AuthNotifyEvent) => void
}

export interface AuthLoginOptions {
  enterpriseDomain?: string
}

export interface OAuthAuth {
  id: string
  name: string
  login: (interaction: AuthInteraction, options?: AuthLoginOptions) => Promise<OAuthCredential>
  refresh: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>
  toAuth: (credential: OAuthCredential) => { apiKey: string; baseUrl?: string }
}
