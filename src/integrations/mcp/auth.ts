import { join } from "node:path";
import { auth, type OAuthClientInformation, type OAuthClientMetadata, type OAuthClientProvider, type OAuthTokens } from "@ai-sdk/mcp";
import { options } from "@config/options.ts";
import type { McpServerOptions } from "@integrations/mcp/config.ts";
import { acquireLock } from "@shared/lock.ts";
import { openInBrowser } from "@shared/open-url.ts";

const REFRESH_GRACE_MS = 5 * 60 * 1000;

const CALLBACK_PORT = 19888;
const CALLBACK_PATH = "/callback";
export const MCP_REDIRECT_URL = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

export type McpAuthEntry = {
  tokens: OAuthTokens;
  expiresAt?: number;
  clientInformation?: OAuthClientInformation;
};
export type McpAuthFile = Record<string, McpAuthEntry>;
const DEFAULT_PATH = join(options.app.systemDir, "mcp-auth.json");
let authFilePath = DEFAULT_PATH;
let cache: McpAuthFile | null = null;

export const initMcpAuthFilePath = (path: string): void => {
  authFilePath = path;
  cache = null;
};

export const resetMcpAuthCache = (): void => {
  cache = null;
};

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

export const listMcpCredentials = (): McpAuthFile => cache ?? {};
export const getMcpCredential = (serverId: string): McpAuthEntry | undefined => listMcpCredentials()[serverId];

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
  persistChain = run.then(
    () => {},
    () => {},
  );
  return run;
};

export const initMcpAuth = async (): Promise<void> => {
  if (cache === null) cache = await readMcpAuthFile(authFilePath);
};

export const setMcpCredential = async (serverId: string, entry: McpAuthEntry): Promise<void> => {
  await persist((current) => ({ ...current, [serverId]: entry }));
};

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

export const isMcpAuthActive = (serverId: string, now = Date.now()): boolean => {
  const entry = getMcpCredential(serverId);
  if (!entry) return false;
  return entry.expiresAt === undefined || entry.expiresAt - REFRESH_GRACE_MS > now;
};

const rootDomain = (host: string): string => host.toLowerCase().split(".").slice(-2).join(".");

const isLocalHost = (host: string): boolean => host === "localhost" || host === "127.0.0.1" || host === "::1";

export const createMcpAuthProvider = (server: McpServerOptions): { provider: OAuthClientProvider; lastAuthorizationUrl: () => URL | undefined } => {
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
      const existing = getMcpCredential(serverId);
      if (!existing?.tokens?.access_token) return;
      await setMcpCredential(serverId, {
        tokens: existing.tokens,
        clientInformation,
        expiresAt: existing.expiresAt,
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
      const expected = new URL(serverUrl);
      const actual = new URL(authorizationServerUrl);
      if (actual.protocol !== "https:" && !isLocalHost(actual.hostname)) {
        throw new Error(`MCP server "${serverId}" advertised an insecure OAuth authorization server: ${actual.origin} (https required)`);
      }
      if (actual.origin === expected.origin) return;
      if (rootDomain(actual.hostname) === rootDomain(expected.hostname) && actual.hostname.includes(".")) return;
      throw new Error(`MCP server "${serverId}" advertised an unexpected OAuth authorization server: ${actual.origin} (expected ${expected.origin})`);
    },
  };
  return { provider, lastAuthorizationUrl: () => lastAuthorizationUrl };
};

type CallbackResult = { code: string; state?: string; issuer?: string };

export const startMcpLogin = async (server: McpServerOptions): Promise<void> => {
  if (server.type === "stdio") {
    throw new Error(`MCP server "${server.id}" is a local stdio server — no OAuth login needed`);
  }
  if (!server.auth) {
    throw new Error(`MCP server "${server.id}" has no "auth": true — enable it in the config first`);
  }
  await initMcpAuth();
  const { provider, lastAuthorizationUrl } = createMcpAuthProvider(server);
  const first = await auth(provider, { serverUrl: server.url! });
  if (first === "AUTHORIZED") {
    console.log(`MCP server "${server.id}" is already logged in.`);
    return;
  }
  const authorizationUrl = lastAuthorizationUrl();
  if (!authorizationUrl) throw new Error(`MCP login for "${server.id}" produced no authorization URL`);
  console.log(`Open this URL to authorize ${server.id}:\n${authorizationUrl}`);
  const callback = await waitForCallback();
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

const waitForCallback = (): Promise<CallbackResult> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        server.stop();
        reject(new Error(`Timed out waiting for the OAuth redirect on ${MCP_REDIRECT_URL}`));
      },
      5 * 60 * 1000,
    );
    const server = Bun.serve({
      port: CALLBACK_PORT,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("Not found", { status: 404 });
        }
        clearTimeout(timeout);
        server.stop(true);
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
