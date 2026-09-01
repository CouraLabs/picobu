/**
 * OAuth types for subscription providers (OpenAI ChatGPT, Anthropic Claude,
 * GitHub Copilot). Credentials live in `<systemDir>/auth.json`; the flows are
 * ports of earendil-works/pi (`packages/ai/src/auth/oauth/*`) adapted to
 * picobu's non-interactive interaction model.
 */

/** A stored OAuth credential (`access`/`refresh`/`expires` are epoch ms). */
export type OAuthCredential = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  /** OpenAI Codex: ChatGPT account id (extracted from the JWT). */
  accountId?: string;
  /** GitHub Copilot: enterprise domain (`.ghe.com` …) when set. */
  enterpriseUrl?: string;
  /** GitHub Copilot: model ids available to the account's subscription. */
  availableModelIds?: string[];
};

/** Notifications a login flow emits; the interaction adapter renders them. */
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

/** Flow-facing interaction handle: abort signal + display notifications. */
export type AuthInteraction = {
  signal: AbortSignal;
  notify: (event: AuthNotifyEvent) => void;
};

/** Optional per-invocation flow inputs (caller-triggered via `startLogin`). */
export type AuthLoginOptions = {
  /** GitHub Copilot: enterprise domain or URL (defaults to github.com). */
  enterpriseDomain?: string;
};

/** A full OAuth provider: login, token refresh, request-auth derivation. */
export type OAuthAuth = {
  /** Canonical provider id (`openai`, `anthropic`, `github-copilot`). */
  id: string;
  /** Display name ("OpenAI", "Anthropic", "GitHub Copilot"). */
  name: string;
  login: (interaction: AuthInteraction, options?: AuthLoginOptions) => Promise<OAuthCredential>;
  refresh: (credential: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>;
  /** Derive per-request auth (apiKey + optional baseUrl override) from a credential. */
  toAuth: (credential: OAuthCredential) => { apiKey: string; baseUrl?: string };
};