/**
 * GitHub Copilot OAuth device-code flow — ported from earendil-works/pi
 * `oauth/github-copilot.ts`, trimmed to picobu's scope (no interactive
 * enterprise prompt: the domain comes from `/login copilot <domain>`).
 */

import type { OAuthAuth, OAuthCredential, AuthInteraction, AuthLoginOptions } from "@auth/types.ts";
import { pollOAuthDeviceCodeFlow } from "@auth/device-code.ts";

const decode = (s: string): string => atob(s);
const CLIENT_ID = decode("SXYxLmI1MDdhMDhjODdlY2ZlOTg=");

const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;
const COPILOT_API_VERSION = "2026-06-01";

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval?: number;
  expires_in: number;
};

type DeviceTokenSuccessResponse = { access_token: string; token_type?: string; scope?: string };
type DeviceTokenErrorResponse = { error: string; error_description?: string; interval?: number };

/** Normalize a user-entered GitHub Enterprise domain/URL to a bare hostname. */
export const normalizeDomain = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname;
  } catch {
    return null;
  }
};

const getUrls = (domain: string): { deviceCodeUrl: string; accessTokenUrl: string; copilotTokenUrl: string } => ({
  deviceCodeUrl: `https://${domain}/login/device/code`,
  accessTokenUrl: `https://${domain}/login/oauth/access_token`,
  copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
});

/** Parse the `proxy-ep` claim from a Copilot token into `api.<host>`. */
const getBaseUrlFromToken = (token: string): string | null => {
  const match = token.match(/proxy-ep=([^;]+)/);
  if (!match) return null;
  const proxyHost = match[1] ?? "";
  const apiHost = proxyHost.replace(/^proxy\./, "api.");
  return `https://${apiHost}`;
};

/**
 * Resolve the Copilot API base URL for a token/account: the token's
 * `proxy-ep` wins, then the enterprise domain, then the public individual
 * endpoint. This is the sense in which the Copilot provider's requests
 * "depend on the model/account".
 */
export const getGitHubCopilotBaseUrl = (token?: string, enterpriseDomain?: string): string => {
  if (token) {
    const fromToken = getBaseUrlFromToken(token);
    if (fromToken) return fromToken;
  }
  if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;
  return "https://api.individual.githubcopilot.com";
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

/**
 * Parse the Copilot `/models` catalog into the model ids usable by the
 * account. Individual accounts report `picker_enabled: false` across the
 * board despite explicit `enabled` policies, so the policy fallback is limited
 * to the public individual endpoint (same gate as pi).
 */
export const parseGitHubCopilotModelCatalog = (raw: unknown, allowPolicyFallback: boolean): string[] => {
  const data = asRecord(raw)?.data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid Copilot models response");
  }
  const accountModels = data.flatMap((rawItem) => {
    const item = asRecord(rawItem);
    const id = item?.id;
    if (!item || typeof id !== "string") return [];
    const supports = asRecord(asRecord(item.capabilities)?.supports);
    if (supports?.tool_calls === false) return [];
    return [
      {
        id,
        pickerEnabled: item.model_picker_enabled === true,
        policyState: asRecord(item.policy)?.state,
      },
    ];
  });

  const pickerModelIds = accountModels
    .filter((m) => m.pickerEnabled && m.policyState !== "disabled")
    .map((m) => m.id);
  if (pickerModelIds.length > 0 || !allowPolicyFallback) {
    return pickerModelIds;
  }
  return accountModels.filter((m) => m.policyState === "enabled").map((m) => m.id);
};

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

async function startDeviceFlow(domain: string, signal: AbortSignal): Promise<DeviceCodeResponse> {
  const { deviceCodeUrl } = getUrls(domain);
  const data = await fetchJson(deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GitHubCopilotChat/0.35.0",
    },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: "read:user" }),
    signal,
  });

  const record = asRecord(data);
  if (!record) throw new Error("Invalid device code response");
  const device = record.device_code;
  const userCode = record.user_code;
  const verificationUri = record.verification_uri;
  const interval = record.interval;
  const expiresIn = record.expires_in;
  if (
    typeof device !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string" ||
    (interval !== undefined && typeof interval !== "number") ||
    typeof expiresIn !== "number"
  ) {
    throw new Error("Invalid device code response fields");
  }

  // Lock the verification URI to http(s) so `open` can never be pointed at a
  // local executable by a compromised server.
  let parsedUri: URL;
  try {
    parsedUri = new URL(verificationUri);
  } catch {
    throw new Error("Untrusted verification_uri in device code response");
  }
  if (parsedUri.protocol !== "https:" && parsedUri.protocol !== "http:") {
    throw new Error("Untrusted verification_uri in device code response");
  }

  return {
    device_code: device,
    user_code: userCode,
    verification_uri: parsedUri.href,
    interval,
    expires_in: expiresIn,
  };
}

async function pollForGitHubAccessToken(
  domain: string,
  device: DeviceCodeResponse,
  signal: AbortSignal,
): Promise<string> {
  const { accessTokenUrl } = getUrls(domain);
  return pollOAuthDeviceCodeFlow<string>({
    intervalSeconds: device.interval,
    expiresInSeconds: device.expires_in,
    waitBeforeFirstPoll: true,
    signal,
    poll: async () => {
      const raw = await fetchJson(accessTokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GitHubCopilotChat/0.35.0",
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal,
      });

      if (asRecord(raw) && typeof (raw as DeviceTokenSuccessResponse).access_token === "string") {
        return { status: "complete", value: (raw as DeviceTokenSuccessResponse).access_token };
      }
      if (asRecord(raw) && typeof (raw as DeviceTokenErrorResponse).error === "string") {
        const { error, error_description: description, interval } = raw as DeviceTokenErrorResponse;
        if (error === "authorization_pending") return { status: "pending" };
        if (error === "slow_down") {
          return { status: "slow_down", intervalSeconds: typeof interval === "number" ? interval : undefined };
        }
        return { status: "failed", message: `Device flow failed: ${error}${description ? `: ${description}` : ""}` };
      }
      return { status: "failed", message: "Invalid device token response" };
    },
  });
}

async function refreshGitHubCopilotAccessToken(
  refreshToken: string,
  enterpriseDomain: string | undefined,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  const domain = enterpriseDomain || "github.com";
  const { copilotTokenUrl } = getUrls(domain);
  const raw = await fetchJson(copilotTokenUrl, {
    headers: { Accept: "application/json", Authorization: `Bearer ${refreshToken}`, ...COPILOT_HEADERS },
    signal,
  });

  const record = asRecord(raw);
  const token = record?.token;
  const expiresAt = record?.expires_at;
  if (typeof token !== "string" || typeof expiresAt !== "number") {
    throw new Error("Invalid Copilot token response fields");
  }

  return {
    type: "oauth",
    refresh: refreshToken,
    access: token,
    // 5-minute safety margin before the hard expiry.
    expires: expiresAt * 1000 - 5 * 60 * 1000,
    enterpriseUrl: enterpriseDomain,
  };
}

async function fetchGitHubCopilotModels(
  copilotToken: string,
  enterpriseDomain: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const baseUrl = getGitHubCopilotBaseUrl(copilotToken, enterpriseDomain);
  return fetchJson(`${baseUrl}/models`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${copilotToken}`,
      ...COPILOT_HEADERS,
      "X-GitHub-Api-Version": COPILOT_API_VERSION,
    },
    signal,
  });
}

const copilotEnterpriseDomain = (credential: OAuthCredential): string | undefined => {
  const enterpriseUrl = credential.enterpriseUrl;
  if (typeof enterpriseUrl !== "string" || !enterpriseUrl) return undefined;
  return normalizeDomain(enterpriseUrl) ?? undefined;
};

async function loginGitHubCopilot(
  interaction: AuthInteraction,
  options?: AuthLoginOptions,
): Promise<OAuthCredential> {
  const input = options?.enterpriseDomain?.trim() ?? "";
  const enterpriseDomain = input ? normalizeDomain(input) ?? undefined : undefined;
  if (input && !enterpriseDomain) throw new Error("Invalid GitHub Enterprise URL/domain");
  const domain = enterpriseDomain || "github.com";

  const device = await startDeviceFlow(domain, interaction.signal);
  interaction.notify({
    type: "device_code",
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    intervalSeconds: device.interval,
    expiresInSeconds: device.expires_in,
  });

  const githubAccessToken = await pollForGitHubAccessToken(domain, device, interaction.signal);
  const credentials = await refreshGitHubCopilotAccessToken(
    githubAccessToken,
    enterpriseDomain,
    interaction.signal,
  );

  interaction.notify({ type: "progress", message: "Fetching your Copilot model catalog…" });
  const catalog = await fetchGitHubCopilotModels(
    credentials.access,
    enterpriseDomain,
    interaction.signal,
  );
  const baseUrl = getGitHubCopilotBaseUrl(credentials.access, enterpriseDomain);
  const allowPolicyFallback = baseUrl === "https://api.individual.githubcopilot.com";
  const availableModelIds = parseGitHubCopilotModelCatalog(catalog, allowPolicyFallback);

  return { ...credentials, availableModelIds };
}

async function refreshGitHubCopilotToken(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
  const credentials = await refreshGitHubCopilotAccessToken(
    credential.refresh,
    copilotEnterpriseDomain(credential),
    signal,
  );
  const catalog = await fetchGitHubCopilotModels(
    credentials.access,
    copilotEnterpriseDomain(credential),
    signal,
  );
  const baseUrl = getGitHubCopilotBaseUrl(credentials.access, copilotEnterpriseDomain(credential));
  const allowPolicyFallback = baseUrl === "https://api.individual.githubcopilot.com";
  const availableModelIds = parseGitHubCopilotModelCatalog(catalog, allowPolicyFallback);
  return { ...credentials, availableModelIds };
}

export const githubCopilotOAuth: OAuthAuth = {
  id: "github-copilot",
  name: "GitHub Copilot",
  login: loginGitHubCopilot,
  refresh: (credential, signal) => refreshGitHubCopilotToken(credential, signal),
  /** Derive the account/token-specific proxy endpoint for each request. */
  toAuth: (credential) => ({
    apiKey: credential.access,
    baseUrl: getGitHubCopilotBaseUrl(credential.access, copilotEnterpriseDomain(credential)),
  }),
};