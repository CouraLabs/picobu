/**
 * OpenAI (ChatGPT) browser OAuth flow — ported from earendil-works/pi
 * `oauth/openai-codex.ts`, trimmed to the browser login path (device-code and
 * manual-code paste are out of picobu scope).
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { OAuthAuth, OAuthCredential, AuthInteraction } from "@auth/types.ts";
import { generatePKCE } from "@auth/pkce.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "@auth/oauth-pages.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type OAuthToken = { access: string; refresh: string; expires: number };
type TokenOperation = "exchange" | "refresh";

export type JwtPayload = {
  [JWT_CLAIM_PATH]?: { chatgpt_account_id?: string };
  [key: string]: unknown;
};

const CALLBACK_PORT = 1455;
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const callbackHost = (): string => process.env.PICOBU_OAUTH_CALLBACK_HOST || "127.0.0.1";

const createState = (): string => randomBytes(16).toString("hex");

/** Race `promise` against a timeout that rejects with `message`. */
const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Decode a JWT payload without signature verification (best-effort). */
export const decodeJwt = (token: string): JwtPayload | null => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1] ?? "";
    return JSON.parse(atob(payload)) as JwtPayload;
  } catch {
    return null;
  }
};

/** Extract the ChatGPT account id claim from an access token. */
export const getAccountId = (accessToken: string): string | null => {
  const payload = decodeJwt(accessToken);
  const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
};

async function fetchWithLoginCancellation(input: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init.signal?.aborted) throw new Error("Login cancelled");
    throw error;
  }
}

async function readTokenResponse(response: Response, operation: TokenOperation): Promise<OAuthToken> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI token ${operation} failed (${response.status}): ${text || response.statusText}`);
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (!json?.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`OpenAI token ${operation} response missing fields: ${JSON.stringify(json)}`);
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  signal: AbortSignal,
): Promise<OAuthToken> {
  const response = await fetchWithLoginCancellation(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
    signal,
  });
  return readTokenResponse(response, "exchange");
}

async function refreshAccessToken(refreshToken: string, signal: AbortSignal): Promise<OAuthToken> {
  const response = await fetchWithLoginCancellation(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
    signal,
  });
  return readTokenResponse(response, "refresh");
}

type CallbackServerInfo = {
  close: () => void;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
};

function startLocalOAuthServer(state: string): Promise<CallbackServerInfo> {
  let settleWait: ((value: { code: string } | null) => void) | undefined;
  const waitForCodePromise = new Promise<{ code: string } | null>((resolve) => {
    let settled = false;
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(oauthErrorHtml("Callback route not found."));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(oauthErrorHtml("State mismatch."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(oauthErrorHtml("Missing authorization code."));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(oauthSuccessHtml("OpenAI authentication completed. You can close this window."));
      settleWait?.({ code });
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(oauthErrorHtml("Internal error while processing OAuth callback."));
    }
  });

  return new Promise((resolve) => {
    server
      .listen(CALLBACK_PORT, callbackHost(), () => {
        resolve({
          close: () => server.close(),
          cancelWait: () => {
            settleWait?.(null);
          },
          waitForCode: () => waitForCodePromise,
        });
      })
      .on("error", () => {
        settleWait?.(null);
        resolve({
          close: () => {
            try {
              server.close();
            } catch {
              // ignore
            }
          },
          cancelWait: () => {},
          waitForCode: async () => null,
        });
      });
  });
}

function credentialsFromToken(token: OAuthToken): OAuthCredential {
  const accountId = getAccountId(token.access);
  if (!accountId) {
    throw new Error("Failed to extract accountId from token");
  }
  return {
    type: "oauth",
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    accountId,
  };
}

async function createAuthorizationFlow(): Promise<{ verifier: string; state: string; url: string }> {
  const { verifier, challenge } = await generatePKCE();
  const state = createState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "picobu");

  return { verifier, state, url: url.toString() };
}

async function loginOpenAI(interaction: AuthInteraction): Promise<OAuthCredential> {
  const { verifier, state, url } = await createAuthorizationFlow();
  const server = await startLocalOAuthServer(state);
  const onAbort = () => server.cancelWait();
  interaction.signal.addEventListener("abort", onAbort, { once: true });
  if (interaction.signal.aborted) onAbort();
  try {
    interaction.notify({
      type: "auth_url",
      url,
      instructions: "A browser window should open. Complete login to finish.",
    });
    const result = await withTimeout(server.waitForCode(), LOGIN_TIMEOUT_MS, "Login timed out — please try again");
    if (!result?.code) throw new Error("Login cancelled");
    interaction.notify({ type: "progress", message: "Exchanging authorization code for tokens…" });
    return credentialsFromToken(await exchangeAuthorizationCode(result.code, verifier, interaction.signal));
  } finally {
    interaction.signal.removeEventListener("abort", onAbort);
    server.close();
  }
}

const refreshOpenAICodexToken = async (refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> =>
  credentialsFromToken(await refreshAccessToken(refreshToken, signal));

export const openaiOAuth: OAuthAuth = {
  id: "openai",
  name: "OpenAI",
  login: loginOpenAI,
  refresh: (credential, signal) => refreshOpenAICodexToken(credential.refresh, signal),
  toAuth: (credential) => ({ apiKey: credential.access }),
};