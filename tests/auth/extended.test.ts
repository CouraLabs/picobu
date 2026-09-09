import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider as ModelsDevProvider } from "@opencode-ai/models";
import { generatePKCE } from "../../src/auth/pkce.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "../../src/auth/oauth-pages.ts";
import { CANCEL_MESSAGE, abortableSleep, pollOAuthDeviceCodeFlow } from "../../src/auth/device-code.ts";
import {
  authFilePathOf,
  getCredential,
  initAuth,
  initAuthFilePath,
  listCredentials,
  readAuthFile,
  removeCredential,
  resetAuthCache,
  setCredential,
} from "../../src/auth/store.ts";
import { fixHarnessAfterLogout, pickDefaultModel, repointModelKey, selectCopilotModels } from "../../src/auth/register.ts";
import { OAUTH_AUTHS, oauthAuthById, startLogin } from "../../src/auth/index.ts";
import { getGitHubCopilotBaseUrl, githubCopilotOAuth } from "../../src/auth/github-copilot.ts";
import { anthropicOAuth } from "../../src/auth/anthropic.ts";
import { openaiOAuth } from "../../src/auth/openai.ts";
import {
  DEFAULT_THEME_PREFS,
  DEFAULT_TUI_OPTIONS,
  DEFAULT_WEB_OPTIONS,
  DEFAULT_WHATSAPP_OPTIONS,
  resolveModelRole,
} from "../../src/config/options.ts";
import type { ProviderOptions } from "../../src/config/options.ts";
import type { OAuthCredential } from "../../src/auth/types.ts";
import { createInteraction } from "../../src/auth/interaction.ts";
import { modelsFromModelsDev } from "../../src/agent/model/catalog-models-dev.ts";
import { initLockDir } from "../../src/shared/lock.ts";

const realFetch = globalThis.fetch;
const realConsoleLog = console.log;
const realConsoleError = console.error;
const realBunSpawn = (Bun as unknown as { spawn: typeof Bun.spawn }).spawn;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function base64UrlEncodeText(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function openAiAccessTokenWithAccount(accountId: string): string {
  const header = base64UrlEncodeText(JSON.stringify({ alg: "none" }));
  const payload = base64UrlEncodeText(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }));
  return `${header}.${payload}.sig`;
}

function credentialForAccess(access: string): OAuthCredential {
  return { type: "oauth", access, refresh: `refresh-${access}`, expires: Date.now() + 3600000 };
}

function mockFetchWithJson(payload: unknown): void {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => payload,
  }) as unknown as Response) as unknown as typeof fetch;
}

function mockFetchWithText(body: string): void {
  globalThis.fetch = (async () => ({
    ok: true,
    text: async () => body,
  }) as unknown as Response) as unknown as typeof fetch;
}

function mockFetchFailure(status: number, body: string): void {
  globalThis.fetch = (async () => ({
    ok: false,
    status,
    statusText: "Request failed",
    text: async () => body,
  }) as unknown as Response) as unknown as typeof fetch;
}

function providerWithModelIds(id: string, ids: string[]): ProviderOptions {
  return {
    id,
    name: id,
    type: "openai",
    baseUrl: "https://example.com/v1",
    models: ids.map((modelId) => ({ id: modelId, name: modelId, context: 100, output: 10 })),
  };
}

function fakeCopilotCatalog(): ModelsDevProvider {
  return {
    id: "github-copilot",
    name: "GitHub Copilot",
    models: {
      "model-a": { id: "model-a", name: "Model A", limit: { context: 100, output: 10 } },
      "model-b": { id: "model-b", name: "Model B", limit: { context: 200, output: 20 }, reasoning: true },
    },
  } as unknown as ModelsDevProvider;
}

describe("generatePKCE", () => {
  test("produces url-safe verifier and challenge with expected lengths", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  test("derives challenge as S256 of verifier", async () => {
    const { verifier, challenge } = await generatePKCE();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64UrlEncodeBytes(new Uint8Array(digest)));
  });
  test("creates unique values across calls", async () => {
    const first = await generatePKCE();
    const second = await generatePKCE();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("oauthSuccessHtml", () => {
  test("renders success markers with doctype and heading", () => {
    const html = oauthSuccessHtml("Anthropic authentication completed. You can close this window.");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Authentication successful");
    expect(html).toContain("Anthropic authentication completed. You can close this window.");
  });
  test("escapes markup in success message", () => {
    const html = oauthSuccessHtml("<script>alert(\"x\")</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  test("leaks no credential field names", () => {
    const html = oauthSuccessHtml("done");
    expect(html).not.toContain("client_secret");
    expect(html).not.toContain("refresh_token");
    expect(html).not.toContain("access_token");
  });
});

describe("oauthErrorHtml", () => {
  test("renders failure markers with message and details", () => {
    const html = oauthErrorHtml("OpenAI authentication did not complete.", "Error: access_denied");
    expect(html).toContain("Authentication failed");
    expect(html).toContain("OpenAI authentication did not complete.");
    expect(html).toContain("Error: access_denied");
  });
  test("escapes markup while keeping secret text readable", () => {
    const html = oauthErrorHtml("Failed", "<token>sk-ant-secret-value-123</token>");
    expect(html).not.toContain("<token>");
    expect(html).toContain("&lt;token&gt;");
    expect(html).toContain("sk-ant-secret-value-123");
  });
  test("omits details block when details absent", () => {
    expect(oauthErrorHtml("nope")).not.toContain("<div class=\"details\">");
  });
  test("includes details block when details present", () => {
    const html = oauthErrorHtml("nope", "some detail");
    expect(html).toContain("<div class=\"details\">");
    expect(html).toContain("some detail");
  });
});

describe("pollOAuthDeviceCodeFlow", () => {
  test("returns value on immediate success", async () => {
    const value = await pollOAuthDeviceCodeFlow<string>({
      intervalSeconds: 0,
      expiresInSeconds: 10,
      signal: new AbortController().signal,
      poll: async () => ({ status: "complete", value: "token-1" }),
    });
    expect(value).toBe("token-1");
  });
  test("waits before first poll when requested", async () => {
    let calls = 0;
    const value = await pollOAuthDeviceCodeFlow<string>({
      intervalSeconds: 0,
      expiresInSeconds: 10,
      waitBeforeFirstPoll: true,
      signal: new AbortController().signal,
      poll: async () => {
        calls += 1;
        return { status: "complete", value: "token-2" };
      },
    });
    expect(value).toBe("token-2");
    expect(calls).toBe(1);
  });
  test("recovers after slow_down then completes", async () => {
    let calls = 0;
    const value = await pollOAuthDeviceCodeFlow<string>({
      intervalSeconds: 0,
      expiresInSeconds: 30,
      signal: new AbortController().signal,
      poll: async () => {
        calls += 1;
        if (calls === 1) return { status: "slow_down", intervalSeconds: 0.001 };
        return { status: "complete", value: "token-3" };
      },
    });
    expect(value).toBe("token-3");
    expect(calls).toBe(2);
  });
  test("throws failure message from device endpoint", async () => {
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        intervalSeconds: 0,
        expiresInSeconds: 10,
        signal: new AbortController().signal,
        poll: async () => ({ status: "failed", message: "Device flow failed: access_denied" }),
      }),
    ).rejects.toThrow("Device flow failed: access_denied");
  });
  test("times out with default message when expired", async () => {
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        intervalSeconds: 0,
        expiresInSeconds: 0.02,
        signal: new AbortController().signal,
        poll: async () => ({ status: "pending" }),
      }),
    ).rejects.toThrow("Device flow timed out");
  });
  test("times out with slow-down hint after slow_down responses", async () => {
    let calls = 0;
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        intervalSeconds: 0,
        expiresInSeconds: 0.05,
        signal: new AbortController().signal,
        poll: async () => {
          calls += 1;
          if (calls === 1) return { status: "slow_down", intervalSeconds: 0.001 };
          return { status: "pending" };
        },
      }),
    ).rejects.toThrow("slow_down");
  });
  test("rejects immediately when signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollOAuthDeviceCodeFlow<string>({
        intervalSeconds: 0,
        expiresInSeconds: 10,
        signal: controller.signal,
        poll: async () => ({ status: "complete", value: "never" }),
      }),
    ).rejects.toThrow(CANCEL_MESSAGE);
  });
});

describe("abortableSleep", () => {
  test("resolves after interval", async () => {
    await expect(abortableSleep(1, new AbortController().signal, CANCEL_MESSAGE)).resolves.toBeUndefined();
  });
  test("rejects when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(1000, controller.signal, "custom-cancel")).rejects.toThrow("custom-cancel");
  });
});

describe("authStoreFileRoundTrip", () => {
  let dir = "";
  let filePath = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "picobu-auth-"));
    initLockDir(dir);
    filePath = join(dir, "auth.json");
    initAuthFilePath(filePath);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  test("points at isolated tmp file", () => {
    expect(authFilePathOf()).toBe(filePath);
  });
  test("round-trips credentials through set get list and remove", async () => {
    await setCredential("openai", credentialForAccess("access-1"));
    expect(getCredential("openai")?.access).toBe("access-1");
    expect(Object.keys(listCredentials())).toContain("openai");
    expect(await removeCredential("openai")).toBe(true);
    expect(getCredential("openai")).toBeUndefined();
  });
  test("overwrites previous credential on repeated set", async () => {
    await setCredential("openai", credentialForAccess("old-access"));
    await setCredential("openai", credentialForAccess("new-access"));
    expect(getCredential("openai")?.access).toBe("new-access");
  });
  test("remove reports false for missing credential", async () => {
    expect(await removeCredential("never-present")).toBe(false);
  });
  test("reloads persisted credentials after cache reset", async () => {
    await setCredential("anthropic", credentialForAccess("access-2"));
    resetAuthCache();
    expect(getCredential("anthropic")).toBeUndefined();
    await initAuth();
    expect(getCredential("anthropic")?.access).toBe("access-2");
  });
  test("reads back written json object", async () => {
    await Bun.write(filePath, JSON.stringify({ openai: credentialForAccess("access-3") }));
    expect((await readAuthFile(filePath)).openai?.access).toBe("access-3");
  });
  test("reads empty object for missing file", async () => {
    expect(await readAuthFile(join(dir, "missing.json"))).toEqual({});
  });
  test("reads empty object for array payload", async () => {
    const arrayPath = join(dir, "array.json");
    await Bun.write(arrayPath, JSON.stringify([1, 2, 3]));
    expect(await readAuthFile(arrayPath)).toEqual({});
  });
  test("backs up corrupt file and returns empty", async () => {
    await Bun.write(filePath, "not-json{{{");
    expect(await readAuthFile(filePath)).toEqual({});
    const entries = await readdir(dir);
    const backup = entries.find((name) => name.startsWith("auth.json.corrupt-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(dir, backup as string), "utf8")).toBe("not-json{{{");
  });
});

describe("pickDefaultModel", () => {
  test("prefers reasoning model over first", () => {
    const models = [
      { id: "plain", name: "plain", context: 1, output: 1 },
      { id: "smart", name: "smart", context: 1, output: 1, reasoning: true },
    ];
    expect(pickDefaultModel(models)).toBe("smart");
  });
  test("falls back to first model without reasoning", () => {
    expect(pickDefaultModel([{ id: "only", name: "only", context: 1, output: 1 }])).toBe("only");
  });
  test("returns undefined for empty models", () => {
    expect(pickDefaultModel([])).toBeUndefined();
  });
});

describe("repointModelKey", () => {
  test("returns key unchanged when provider prefix absent", () => {
    expect(repointModelKey("openai/gpt", "github-copilot", [])).toBe("openai/gpt");
  });
  test("keeps previous key when no providers remain", () => {
    expect(repointModelKey("github-copilot/model-x", "github-copilot", [])).toBe("github-copilot/model-x");
  });
  test("repoints to first provider default model", () => {
    expect(repointModelKey("github-copilot/x", "github-copilot", [providerWithModelIds("openai", ["g1"])])).toBe(
      "openai/g1",
    );
  });
  test("prefers reasoning model of fallback provider", () => {
    const fallback: ProviderOptions = {
      id: "openai",
      name: "openai",
      type: "openai",
      baseUrl: "https://example.com/v1",
      models: [
        { id: "plain", name: "plain", context: 1, output: 1 },
        { id: "smart", name: "smart", context: 1, output: 1, reasoning: true },
      ],
    };
    expect(repointModelKey("github-copilot/x", "github-copilot", [fallback])).toBe("openai/smart");
  });
});

describe("selectCopilotModels", () => {
  test("returns empty for empty allowlist", () => {
    expect(selectCopilotModels(fakeCopilotCatalog(), [])).toEqual([]);
  });
  test("falls back to full catalog when allowlist undefined", () => {
    const catalog = fakeCopilotCatalog();
    expect(selectCopilotModels(catalog, undefined)).toEqual(modelsFromModelsDev(catalog));
  });
  test("filters catalog to wanted ids", () => {
    expect(selectCopilotModels(fakeCopilotCatalog(), ["model-a"]).map((model) => model.id)).toEqual(["model-a"]);
  });
  test("appends unknown ids as text-only extras", () => {
    const models = selectCopilotModels(fakeCopilotCatalog(), ["model-a", "ghost-model"]);
    const ghost = models.find((model) => model.id === "ghost-model");
    expect(models.map((model) => model.id).sort()).toEqual(["ghost-model", "model-a"]);
    expect(ghost?.supports).toEqual(["text"]);
    expect(ghost?.context).toBe(0);
  });
});

describe("fixHarnessAfterLogout", () => {
  test("repoints logged-out selectors to fallback and keeps others", () => {
    const next = fixHarnessAfterLogout(
      { defaultModel: "github-copilot/x", modelRoles: { tiny: "github-copilot/x", flash: "other/y" } },
      "github-copilot",
      [providerWithModelIds("openai", ["fallback"])],
    );
    expect(next.defaultModel).toBe("openai/fallback");
    expect(next.modelRoles?.tiny).toBe("openai/fallback");
    expect(next.modelRoles?.flash).toBe("other/y");
  });
});

describe("oauthAuthById", () => {
  test("matches ids case-insensitively with surrounding spaces", () => {
    expect(oauthAuthById(" OpenAI ")?.id).toBe("openai");
    expect(oauthAuthById("ANTHROPIC")?.id).toBe("anthropic");
    expect(oauthAuthById("  github-copilot ")?.id).toBe("github-copilot");
  });
  test("resolves provider aliases", () => {
    expect(oauthAuthById("copilot")?.id).toBe("github-copilot");
    expect(oauthAuthById("claude")?.id).toBe("anthropic");
    expect(oauthAuthById("chatgpt")?.id).toBe("openai");
  });
  test("returns undefined for unknown provider", () => {
    expect(oauthAuthById("no-such-provider")).toBeUndefined();
  });
  test("exposes three registered providers", () => {
    expect(OAUTH_AUTHS.map((auth) => auth.id).sort()).toEqual(["anthropic", "github-copilot", "openai"]);
  });
  test("logs error for unknown provider login without throwing", async () => {
    const messages: string[] = [];
    console.error = (...args: unknown[]) => {
      messages.push(args.map((part) => String(part)).join(" "));
    };
    try {
      await startLogin("no-such-provider-xyz");
    } finally {
      console.error = realConsoleError;
    }
    expect(messages.some((message) => message.includes("Unknown OAuth provider"))).toBe(true);
  });
});

describe("anthropicOAuth", () => {
  test("exposes oauth metadata with apiKey mapping", () => {
    expect(anthropicOAuth.id).toBe("anthropic");
    expect(anthropicOAuth.name).toBe("Anthropic");
    expect(anthropicOAuth.toAuth(credentialForAccess("access-9")).apiKey).toBe("access-9");
  });
  test("rejects refresh payload with missing fields", async () => {
    mockFetchWithText(JSON.stringify({ access_token: "only-access" }));
    await expect(anthropicOAuth.refresh(credentialForAccess("old"), AbortSignal.timeout(5000))).rejects.toThrow(
      "missing fields",
    );
  });
  test("rejects failed http refresh", async () => {
    mockFetchFailure(401, "unauthorized");
    await expect(anthropicOAuth.refresh(credentialForAccess("old"), AbortSignal.timeout(5000))).rejects.toThrow("401");
  });
  test("refreshes tokens from complete payload", async () => {
    mockFetchWithText(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    const credential = await anthropicOAuth.refresh(credentialForAccess("old"), AbortSignal.timeout(5000));
    expect(credential.access).toBe("new-access");
    expect(credential.refresh).toBe("new-refresh");
    expect(credential.type).toBe("oauth");
    expect(credential.expires).toBeGreaterThan(Date.now());
  });
});

describe("openaiOAuth", () => {
  test("exposes oauth metadata with apiKey mapping", () => {
    expect(openaiOAuth.id).toBe("openai");
    expect(openaiOAuth.toAuth(credentialForAccess("access-9")).apiKey).toBe("access-9");
  });
  test("rejects refresh payload with missing fields", async () => {
    mockFetchWithJson({ access_token: "only-access" });
    await expect(openaiOAuth.refresh(credentialForAccess("old"), new AbortController().signal)).rejects.toThrow(
      "missing fields",
    );
  });
  test("rejects failed http refresh", async () => {
    mockFetchFailure(401, "bad credentials");
    await expect(openaiOAuth.refresh(credentialForAccess("old"), new AbortController().signal)).rejects.toThrow("401");
  });
  test("rejects token without account claim", async () => {
    const header = base64UrlEncodeText(JSON.stringify({ alg: "none" }));
    const payload = base64UrlEncodeText(JSON.stringify({ sub: "user-without-claim" }));
    mockFetchWithJson({ access_token: `${header}.${payload}.sig`, refresh_token: "r1", expires_in: 3600 });
    await expect(openaiOAuth.refresh(credentialForAccess("old"), new AbortController().signal)).rejects.toThrow(
      "accountId",
    );
  });
  test("refreshes credential and extracts account id", async () => {
    const token = openAiAccessTokenWithAccount("acc-1");
    mockFetchWithJson({ access_token: token, refresh_token: "r2", expires_in: 3600 });
    const credential = await openaiOAuth.refresh(credentialForAccess("old"), new AbortController().signal);
    expect(credential.accountId).toBe("acc-1");
    expect(credential.access).toBe(token);
    expect(openaiOAuth.toAuth(credential).apiKey).toBe(token);
  });
});

describe("getGitHubCopilotBaseUrl", () => {
  test("defaults to individual api", () => {
    expect(getGitHubCopilotBaseUrl()).toBe("https://api.individual.githubcopilot.com");
  });
  test("derives base from enterprise domain", () => {
    expect(getGitHubCopilotBaseUrl(undefined, "example.ghe.com")).toBe("https://copilot-api.example.ghe.com");
  });
  test("derives base from proxy token", () => {
    expect(getGitHubCopilotBaseUrl("prefix;proxy-ep=proxy.myhost.com;suffix")).toBe("https://api.myhost.com");
  });
  test("prefers token proxy over enterprise domain", () => {
    expect(getGitHubCopilotBaseUrl("prefix;proxy-ep=proxy.myhost.com;suffix", "example.ghe.com")).toBe(
      "https://api.myhost.com",
    );
  });
  test("maps credential to auth with default base url", () => {
    expect(githubCopilotOAuth.id).toBe("github-copilot");
    const auth = githubCopilotOAuth.toAuth(credentialForAccess("copilot-token"));
    expect(auth.apiKey).toBe("copilot-token");
    expect(auth.baseUrl).toBe("https://api.individual.githubcopilot.com");
  });
});

describe("configDefaults", () => {
  test("tui default max messages is finite positive", () => {
    expect(DEFAULT_TUI_OPTIONS.maxMessages).toBe(20);
    expect(Number.isFinite(DEFAULT_TUI_OPTIONS.maxMessages)).toBe(true);
  });
  test("web defaults carry host and port", () => {
    expect(DEFAULT_WEB_OPTIONS).toEqual({ host: "0.0.0.0", port: 8080 });
  });
  test("whatsapp defaults to disabled without numbers", () => {
    expect(DEFAULT_WHATSAPP_OPTIONS).toEqual({ enabled: false, allowedNumbers: [] });
  });
  test("theme defaults to dark tacos", () => {
    expect(DEFAULT_THEME_PREFS).toEqual({ key: "tacos", variant: "dark" });
  });
});

describe("resolveModelRole", () => {
  test("throws when default model missing", () => {
    expect(() => resolveModelRole(undefined, "tiny")).toThrow("No defaultModel is set");
    expect(() => resolveModelRole({}, "flash")).toThrow("No defaultModel is set");
  });
  test("falls back to default model for plain roles", () => {
    expect(resolveModelRole({ defaultModel: "openai/g1" }, "tiny")).toEqual({ modelKey: "openai/g1", thinking: "none" });
    expect(resolveModelRole({ defaultModel: "openai/g1" }, "flash")).toEqual({
      modelKey: "openai/g1",
      thinking: undefined,
    });
    expect(resolveModelRole({ defaultModel: "openai/g1" }, "heavy")).toEqual({
      modelKey: "openai/g1",
      thinking: undefined,
    });
  });
  test("prefers explicit role model over default", () => {
    const resolved = resolveModelRole({ defaultModel: "openai/g1", modelRoles: { tiny: "anthropic/m1" } }, "tiny");
    expect(resolved.modelKey).toBe("anthropic/m1");
  });
  test("applies thinking defaults for reasoning roles", () => {
    expect(resolveModelRole({ defaultModel: "openai/g1" }, "flashThinking")).toEqual({
      modelKey: "openai/g1",
      thinking: "medium",
    });
    expect(resolveModelRole({ defaultModel: "openai/g1" }, "heavyThinkingLevel")).toEqual({
      modelKey: "openai/g1",
      thinking: "high",
    });
  });
  test("honors explicit thinking levels", () => {
    const flash = resolveModelRole({ defaultModel: "openai/g1", modelRoles: { flashThinking: "high" } }, "flashThinking");
    const heavy = resolveModelRole(
      { defaultModel: "openai/g1", modelRoles: { heavyThinkingLevel: "low" } },
      "heavyThinkingLevel",
    );
    expect(flash.thinking).toBe("high");
    expect(heavy.thinking).toBe("low");
  });
});

describe("createInteraction", () => {
  let logs: string[] = [];
  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map((part) => String(part)).join(" "));
    };
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = (() => ({ unref() {} }) as unknown as ReturnType<
      typeof Bun.spawn
    >) as typeof Bun.spawn;
  });
  afterEach(() => {
    console.log = realConsoleLog;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = realBunSpawn;
  });
  test("passes signal through to interaction", () => {
    const controller = new AbortController();
    expect(createInteraction("openai", "OpenAI", controller.signal).signal).toBe(controller.signal);
  });
  test("announces browser url for auth flow", () => {
    const interaction = createInteraction("openai", "OpenAI", new AbortController().signal);
    interaction.notify({ type: "auth_url", url: "http://127.0.0.1:1/callback", instructions: "Finish in browser" });
    expect(logs.some((line) => line.includes("OpenAI") && line.includes("Finish in browser"))).toBe(true);
  });
  test("announces device code and verification uri", () => {
    const interaction = createInteraction("github-copilot", "GitHub Copilot", new AbortController().signal);
    interaction.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "http://127.0.0.1:1/device" });
    expect(logs.some((line) => line.includes("ABCD-1234"))).toBe(true);
  });
  test("announces progress messages", () => {
    const interaction = createInteraction("anthropic", "Anthropic", new AbortController().signal);
    interaction.notify({ type: "progress", message: "Exchanging code" });
    expect(logs.some((line) => line.includes("Exchanging code"))).toBe(true);
  });
});
