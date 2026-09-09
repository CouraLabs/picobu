export type OAuthCredential = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
  availableModelIds?: string[];
};

export type AuthNotifyEvent =
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

export type AuthInteraction = {
  signal: AbortSignal;
  notify: (event: AuthNotifyEvent) => void;
};

export type AuthLoginOptions = {
  enterpriseDomain?: string;
};

export type OAuthAuth = {
  id: string;
  name: string;
  login: (interaction: AuthInteraction, options?: AuthLoginOptions) => Promise<OAuthCredential>;
  refresh: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>;
  toAuth: (credential: OAuthCredential) => { apiKey: string; baseUrl?: string };
};
