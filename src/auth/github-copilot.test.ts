import { describe, expect, test } from "bun:test";
import { getGitHubCopilotBaseUrl, normalizeDomain, parseGitHubCopilotModelCatalog } from "./github-copilot";

describe("getGitHubCopilotBaseUrl", () => {
  test("derives the API host from the token's proxy-ep claim", () => {
    expect(getGitHubCopilotBaseUrl("tid=1;exp=2;proxy-ep=proxy.individual.githubcopilot.com;x=1")).toBe(
      "https://api.individual.githubcopilot.com",
    );
    expect(getGitHubCopilotBaseUrl("proxy-ep=proxy.enterprise.githubcopilot.com;")).toBe(
      "https://api.enterprise.githubcopilot.com",
    );
  });

  test("falls back to the enterprise domain when no token claim exists", () => {
    expect(getGitHubCopilotBaseUrl("no-proxy-here", "company.ghe.com")).toBe(
      "https://copilot-api.company.ghe.com",
    );
  });

  test("defaults to the public individual endpoint", () => {
    expect(getGitHubCopilotBaseUrl()).toBe("https://api.individual.githubcopilot.com");
    expect(getGitHubCopilotBaseUrl("no-proxy-here")).toBe("https://api.individual.githubcopilot.com");
  });
});

describe("normalizeDomain", () => {
  test("normalizes bare domains and URLs to a hostname", () => {
    expect(normalizeDomain("company.ghe.com")).toBe("company.ghe.com");
    expect(normalizeDomain("  https://company.ghe.com/foo  ")).toBe("company.ghe.com");
  });

  test("rejects empty or unparseable input", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain("not a url")).toBeNull();
  });
});

describe("parseGitHubCopilotModelCatalog", () => {
  const item = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    id: "m",
    model_picker_enabled: true,
    capabilities: { supports: { tool_calls: true } },
    ...overrides,
  });

  test("keeps picker models, drops non-tool-calling and policy-disabled ones", () => {
    const catalog = {
      data: [
        item({ id: "gpt-5.2" }),
        item({ id: "embed-only", capabilities: { supports: { tool_calls: false } } }),
        item({ id: "disabled", policy: { state: "disabled" } }),
      ],
    };
    expect(parseGitHubCopilotModelCatalog(catalog, false)).toEqual(["gpt-5.2"]);
  });

  test("without picker flags the individual-account policy fallback kicks in", () => {
    const catalog = {
      data: [
        item({ id: "claude-sonnet-4.6", model_picker_enabled: false, policy: { state: "enabled" } }),
        item({ id: "off", model_picker_enabled: false, policy: { state: "disabled" } }),
      ],
    };
    expect(parseGitHubCopilotModelCatalog(catalog, true)).toEqual(["claude-sonnet-4.6"]);
  });

  test("the fallback is disabled for non-individual hosts", () => {
    const catalog = {
      data: [item({ id: "claude-sonnet-4.6", model_picker_enabled: false, policy: { state: "enabled" } })],
    };
    expect(parseGitHubCopilotModelCatalog(catalog, false)).toEqual([]);
  });

  test("throws on malformed payloads", () => {
    expect(() => parseGitHubCopilotModelCatalog({}, false)).toThrow("Invalid Copilot models response");
    expect(() => parseGitHubCopilotModelCatalog(null, false)).toThrow("Invalid Copilot models response");
  });
});