import { describe, expect, test } from "bun:test";
import { parseMarkdown } from "../../src/agent/markdown/markdown-parser.ts";
import { resolveModelRef } from "../../src/agent/model/resolver.ts";

describe("parseMarkdown", () => {
  test("parses frontmatter and body", () => {
    const parsed = parseMarkdown<{ name: string }>(`---\nname: coder\n---\nhello body`);
    expect(parsed.name).toBe("coder");
    expect(parsed.content).toBe("hello body");
  });
  test("keeps numeric names as strings", () => {
    const parsed = parseMarkdown<{ name: unknown }>(`---\nname: 123\n---\nbody`);
    expect(parsed.name).toBe("123");
  });
  test("body horizontal rule does not truncate", () => {
    const parsed = parseMarkdown(`---\nname: x\n---\nfirst\n---\nsecond`);
    expect(parsed.content).toContain("second");
  });
  test("unclosed frontmatter does not leak yaml", () => {
    const parsed = parseMarkdown(`---\nname: x\nbody without close`);
    expect(parsed.content).not.toContain("name:");
  });
  test("missing frontmatter returns raw body", () => {
    expect(parseMarkdown("plain body").content).toBe("plain body");
  });
});

describe("resolveModelRef", () => {
  test("throws on unknown provider", () => {
    expect(() => resolveModelRef("nope-typo/model")).toThrow("Unknown provider");
  });
  test("throws on unknown model for known provider shape", () => {
    expect(() => resolveModelRef("unknown-provider-xyz/anything")).toThrow("Unknown provider");
  });
  test("throws when nothing configured", () => {
    expect(() => resolveModelRef("only-provider-without-slash-xyz")).toThrow();
  });
});
