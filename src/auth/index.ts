import { anthropicOAuth } from "./anthropic";
import { githubCopilotOAuth } from "./github-copilot";
import { openaiOAuth } from "./openai";
import { createInteraction } from "./interaction";
import { registerOAuthProvider } from "./register";
import { getCredential, initAuth, listCredentials, setCredential } from "./store";
import type { OAuthAuth } from "./types";

/** Advisory margin: treat a credential as stale shortly before hard expiry. */
const REFRESH_GRACE_MS = 5 * 60 * 1000;

/** Registered OAuth providers, in picker order. */
export const OAUTH_AUTHS: OAuthAuth[] = [openaiOAuth, anthropicOAuth, githubCopilotOAuth];

/** Friendly invocation aliases (`/login copilot` → github-copilot). */
const PROVIDER_ALIASES: Record<string, string> = { copilot: "github-copilot", claude: "anthropic", chatgpt: "openai" };

export const oauthAuthById = (raw: string): OAuthAuth | undefined => {
  const id = PROVIDER_ALIASES[raw.trim().toLowerCase()] ?? raw;
  return OAUTH_AUTHS.find((auth) => auth.id === id);
};

export type OAuthProviderInfo = { id: string; name: string; loggedIn: boolean };

/** Provider rows for the login/logout picker (sync; requires `initAuth`). */
export const listOAuthProviders = (): OAuthProviderInfo[] =>
  OAUTH_AUTHS.map((auth) => ({
    id: auth.id,
    name: auth.name,
    loggedIn: Boolean(getCredential(auth.id)),
  }));

let activeLoginAbort: AbortController | null = null;

/** Abort the in-flight login flow (wired to the status dialog's Cancel). */
export const cancelLogin = (): void => activeLoginAbort?.abort();

/**
 * Run a provider OAuth login (browser / device-code), then register the
 * provider + models in options.json. Progress is logged to the console.
 */
export const startLogin = async (id: string, opts?: string): Promise<void> => {
  const auth = oauthAuthById(id);
  if (!auth) {
    console.error(`Unknown OAuth provider "${id}"`);
    return;
  }
  activeLoginAbort?.abort();
  const controller = new AbortController();
  activeLoginAbort = controller;
  try {
    const interaction = createInteraction(auth.id, auth.name, controller.signal);
    // An optional extra argument supplies the enterprise domain (copilot);
    // other flows ignore it.
    const options = opts?.trim() ? { enterpriseDomain: opts.trim() } : undefined;
    const credential = await auth.login(interaction, options);
    controller.signal.throwIfAborted();
    await registerOAuthProvider(auth, credential);
    controller.signal.throwIfAborted();
    console.log(`Logged in as ${auth.name} — provider & models registered`);
  } catch (error) {
    console.error(
      `Login failed for ${auth.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (activeLoginAbort === controller) activeLoginAbort = null;
  }
};

let refreshInFlight: Promise<void> | null = null;

/**
 * Refresh every stored credential close to expiry, serialized so concurrent
 * callers (app boot, each run start) share one pass. Failures keep the stale
 * credential — `resolveAuth` surfaces an actionable `/login` error at request
 * time instead of silently building a keyless client.
 */
export const ensureOAuthTokens = (): Promise<void> => {
  refreshInFlight ??= refreshOAuthTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
};

export const refreshOAuthTokens = async (): Promise<void> => {
  await initAuth();
  const credentials = listCredentials();
  for (const [id, credential] of Object.entries(credentials)) {
    if (credential.expires - REFRESH_GRACE_MS > Date.now()) continue;
    const auth = oauthAuthById(id);
    if (!auth) continue;
    try {
      const fresh = await auth.refresh(credential, AbortSignal.timeout(60_000));
      if (fresh.expires - REFRESH_GRACE_MS <= Date.now()) continue;
      await setCredential(id, fresh);
    } catch {
      // keep the stale credential — resolveAuth surfaces an actionable error
    }
  }
};