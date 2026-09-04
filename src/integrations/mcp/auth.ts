import { join } from "node:path";
import { auth, type OAuthClientInformation, type OAuthClientMetadata, type OAuthClientProvider, type OAuthTokens } from "@ai-sdk/mcp";
import { options } from "@config/options.ts";
import { acquireLock } from "@shared/lock.ts";
import { openInBrowser } from "@shared/open-url.ts";
import type { McpServerOptions } from "@integrations/mcp/config.ts";

/**
 * MCP OAuth: tokens live in `<systemDir>/mcp-auth.json` keyed by server id
 * (lock-guarded + cached like `@auth/store.ts`). The protocol work — metadata
 * discovery, dynamic client registration, PKCE, token exchange and refresh —
 * is `auth()` from `@ai-sdk/mcp`; this module supplies the storage-side
 * `OAuthClientProvider` and the browser/localhost-callback dance.
 */

/** Advisory margin: a credential close to expiry counts as inactive (same rule as `@auth`). */
const REFRESH_GRACE_MS = 5 * 60 * 1000;

/** Local port for the OAuth redirect listener. Fixed so the dynamic client
 * registration (`redirect_uris`) is stable across logins. */
const CALLBACK_PORT = 19888;
const CALLBACK_PATH = "/callback";
export const MCP_REDIRECT_URL = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

/** Per-server stored state: tokens + the dynamic client registration. */
export type McpAuthEntry = {
  tokens: OAuthTokens;
  /** Epoch ms when `access_token` expires (from `expires_in`); absent for non-expiring tokens. */
  expiresAt?: number;
  /** Dynamic-registration client id/secret for this server. */
  clientInformation?: OAuthClientInformation;
};

export type McpAuthFile = Record<string, McpAuthEntry>;

const DEFAULT_PATH = join(options.app.systemDir, "mcp-auth.json");

let authFilePath = DEFAULT_PATH;
let cache: McpAuthFile | null = null;

/** Override the mcp-auth.json path (tests). Clears the cache. */
export const initMcpAuthFilePath = (path: string): void => {
  authFilePath = path;
  cache = null;
};

/** Drop the in-memory cache so the next read reloads from disk. */
export const resetMcpAuthCache = (): void => {
  cache = null;
};

/** Read the raw store at `path`; missing/broken files resolve to `{}`. */
export const readMcpAuthFile = async (path: string): Promise<McpAuthFile> => {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return {};
    const parsed: unknown = await file.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as McpAuthFile;
  } catch {
    return {};
  }
};

/** All stored MCP credentials (sync; empty until `initMcpAuth` has run). */
export const listMcpCredentials = (): McpAuthFile => cache ?? {};

export const getMcpCredential = (serverId: string): McpAuthEntry | undefined => listMcpCredentials()[serverId];

/**
 * Read-modify-write serialization: `acquireLock` only blocks *foreign*
 * processes (own entries are re-entrant), so concurrent same-process writes
 * would race on read-modify-write. Every persist queues behind the previous
 * one; the file lock still guards cross-instance access.
 */
let persistChain: Promise<void> = Promise.resolve();

const persist = (mutate: (current: McpAuthFile) => McpAuthFile): Promise<void> => {
  const run = persistChain.then(async () => {
    const lock = await acquireLock(authFilePath);
    try {
      const current = await readMcpAuthFile(authFilePath);
      const updated = mutate(current);
      cache = updated;
      await Bun.write(authFilePath, JSON.stringify(updated, null, 2));
    } finally {
      lock.release();
    }
  });
  persistChain = run.then(() => {}, () => {});
  return run;
};

/** Load the store into the singleton cache (idempotent, best-effort). */
export const initMcpAuth = async (): Promise<void> => {
  if (cache === null) cache = await readMcpAuthFile(authFilePath);
};

/** Store (or replace) the credential for a server id. */
export const setMcpCredential = async (serverId: string, entry: McpAuthEntry): Promise<void> => {
  await persist((current) => ({ ...current, [serverId]: entry }));
};

/** Remove the credential for a server id; returns false when none was stored. */
export const removeMcpCredential = async (serverId: string): Promise<boolean> => {
  let removed = false;
  await persist((current) => {
    if (!current[serverId]) return current;
    removed = true;
    const { [serverId]: _removed, ...rest } = current;
    return rest;
  });
  return removed;
};

/**
 * Whether a stored credential is currently valid: present and not within the
 * refresh grace of expiry (or non-expiring). Drives the `authActive` flag.
 */
export const isMcpAuthActive = (serverId: string, now = Date.now()): boolean => {
  const entry = getMcpCredential(serverId);
  if (!entry) return false;
  return entry.expiresAt === undefined || entry.expiresAt - REFRESH_GRACE_MS > now;
};

/**
 * The `OAuthClientProvider` for one server: persists tokens + client info in
 * `mcp-auth.json` and handles the redirect/steps of the `auth()` flow.
 * The allow-list check defaults to same-origin-only: an MCP server must not
 * be able to point picobu's OAuth redirect at an arbitrary authorization
 * server it didn't advertise at config time.
 *
 * Returns the provider plus `lastAuthorizationUrl` — the URL the most recent
 * `redirectToAuthorization` received (the login flow opens it in the browser
 * and the CLI echoes it for headless terminals).
 */
export const createMcpAuthProvider = (
  server: McpServerOptions,
): { provider: OAuthClientProvider; lastAuthorizationUrl: () => URL | undefined } => {
  const serverId = server.id;
  const serverUrl = server.url!;
  let lastAuthorizationUrl: URL | undefined;
  let verifier: string | undefined;
  let state: string | undefined;

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return MCP_REDIRECT_URL;
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: `picobu (${serverId})`,
        redirect_uris: [MCP_REDIRECT_URL],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    async tokens() {
      return getMcpCredential(serverId)?.tokens;
    },
    async saveTokens(tokens) {
      const existing = getMcpCredential(serverId);
      await setMcpCredential(serverId, {
        tokens,
        clientInformation: existing?.clientInformation,
        expiresAt: tokens.expires_in !== undefined ? Date.now() + tokens.expires_in * 1000 : undefined,
      });
    },
    async clientInformation() {
      return getMcpCredential(serverId)?.clientInformation;
    },
    async saveClientInformation(clientInformation) {
      await setMcpCredential(serverId, {
        // saveClientInformation can fire before any tokens exist.
        tokens: getMcpCredential(serverId)?.tokens ?? ({ access_token: "", token_type: "" } as OAuthTokens),
        clientInformation,
        expiresAt: getMcpCredential(serverId)?.expiresAt,
      });
    },
    async redirectToAuthorization(authorizationUrl) {
      lastAuthorizationUrl = authorizationUrl;
      openInBrowser(authorizationUrl.toString());
    },
    async saveCodeVerifier(codeVerifier) {
      verifier = codeVerifier;
    },
    async codeVerifier() {
      if (!verifier) throw new Error(`No code verifier stored for MCP server "${serverId}"`);
      return verifier;
    },
    state() {
      state = crypto.randomUUID();
      return state;
    },
    saveState(saved) {
      state = saved;
    },
    storedState() {
      return state;
    },
    validateAuthorizationServerURL(_serverUrl, authorizationServerUrl) {
      const advertised = new URL(serverUrl).origin;
      if (new URL(authorizationServerUrl).origin !== advertised) {
        throw new Error(
          `MCP server "${serverId}" advertised an unexpected OAuth authorization server: ${new URL(authorizationServerUrl).origin} (expected ${advertised})`,
        );
      }
    },
  };
  return { provider, lastAuthorizationUrl: () => lastAuthorizationUrl };
};

/** Where the login's browser redirect landed; set by the callback listener. */
type CallbackResult = { code: string; state?: string; issuer?: string };

/**
 * Run the interactive OAuth login for a server: discovery + dynamic client
 * registration via `auth()` (which calls `redirectToAuthorization` — the
 * browser opens), then a localhost callback listener captures the redirect,
 * and `auth()` runs a second time to exchange the code for tokens.
 * Resolves when tokens are stored; throws a descriptive error otherwise.
 */
export const startMcpLogin = async (server: McpServerOptions): Promise<void> => {
  if (server.type === "stdio") {
    throw new Error(`MCP server "${server.id}" is a local stdio server — no OAuth login needed`);
  }
  if (!server.auth) {
    throw new Error(`MCP server "${server.id}" has no "auth": true — enable it in the config first`);
  }
  await initMcpAuth();
  const { provider, lastAuthorizationUrl } = createMcpAuthProvider(server);

  // First pass: no tokens yet → the provider redirects to the authorization
  // URL (browser opens) and `auth()` returns "REDIRECT".
  const first = await auth(provider, { serverUrl: server.url! });
  if (first === "AUTHORIZED") {
    console.log(`MCP server "${server.id}" is already logged in.`);
    return;
  }
  const authorizationUrl = lastAuthorizationUrl();
  if (!authorizationUrl) throw new Error(`MCP login for "${server.id}" produced no authorization URL`);
  console.log(`Open this URL to authorize ${server.id}:\n${authorizationUrl}`);

  // Capture the redirect: localhost listener + browser open (already done).
  const callback = await waitForCallback();

  // Second pass: exchange the authorization code for tokens.
  const second = await auth(provider, {
    serverUrl: server.url!,
    authorizationCode: callback.code,
    callbackState: callback.state,
    callbackIssuer: callback.issuer,
  });
  if (second !== "AUTHORIZED") {
    throw new Error(`MCP login for "${server.id}" did not complete (flow returned "${second}")`);
  }
  console.log(`Logged in to MCP server "${server.id}" — tokens stored in ${authFilePath}`);
};

/**
 * Ensure a server's OAuth tokens are valid before connecting. Expired tokens
 * (past the grace margin) go through `auth()` once so the package can refresh
 * them; a "REDIRECT" result means no usable session — surfaced as an
 * actionable error instead of a stream of 401s mid-run.
 */
export const ensureMcpAuth = async (server: McpServerOptions): Promise<void> => {
  if (!server.auth || server.type === "stdio") return;
  await initMcpAuth();
  if (isMcpAuthActive(server.id)) return;
  const { provider } = createMcpAuthProvider(server);
  const result = await auth(provider, { serverUrl: server.url! });
  if (result !== "AUTHORIZED") {
    throw new Error(`MCP server "${server.id}" requires login — run \`picobu mcp login ${server.id}\``);
  }
};

/** Await the browser callback on the fixed localhost listener (5-min timeout). */const waitForCallback = (): Promise<CallbackResult> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error(`Timed out waiting for the OAuth redirect on ${MCP_REDIRECT_URL}`));
    }, 5 * 60 * 1000);
    const server = Bun.serve({
      port: CALLBACK_PORT,
      async fetch(request) {
        clearTimeout(timeout);
        server.stop(true);
        const url = new URL(request.url);
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("Not found", { status: 404 });
        }
        const error = url.searchParams.get("error");
        if (error) {
          reject(new Error(`OAuth redirect reported an error: ${error} (${url.searchParams.get("error_description") ?? "no detail"})`));
          return new Response("picobu: MCP login failed — see the terminal.", { status: 400 });
        }
        const code = url.searchParams.get("code");
        if (!code) {
          reject(new Error("OAuth redirect carried no authorization code"));
          return new Response("picobu: MCP login failed — see the terminal.", { status: 400 });
        }
        resolve({
          code,
          state: url.searchParams.get("state") ?? undefined,
          issuer: url.searchParams.get("iss") ?? undefined,
        });
        return new Response("picobu: MCP login complete — you can close this tab.", { status: 200 });
      },
      error() {
        return new Response("error", { status: 500 });
      },
    });
  });
