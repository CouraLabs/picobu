import { describe, expect, test } from "bun:test";
import { assertSafeUrl } from "../../src/agent/tools/web/browser.ts";
import { htmlToMarkdown } from "../../src/agent/tools/web/html-to-markdown.ts";
import { fetchAsMarkdown, WebfetchToolArgsSchema } from "../../src/agent/tools/web/webfetch.ts";
import { parseSearchPage, resolveDdgHref, WebsearchToolArgsSchema } from "../../src/agent/tools/web/websearch.ts";

describe("htmlToMarkdown", () => {
  test("converts h1 to atx heading", () => {
    expect(htmlToMarkdown("<h1>Hello</h1>")).toBe("# Hello");
  });
  test("converts anchor to markdown link", () => {
    expect(htmlToMarkdown('<a href="https://example.com">click</a>')).toBe("[click](https://example.com)");
  });
  test("converts inline code to backticks", () => {
    expect(htmlToMarkdown("<p>hi <code>x()</code></p>")).toBe("hi `x()`");
  });
  test("converts pre block to fenced block", () => {
    const out = htmlToMarkdown("<pre><code>const a = 1;</code></pre>");
    expect(out.startsWith("```")).toBe(true);
    expect(out).toContain("const a = 1;");
  });
  test("strips script style noscript iframe", () => {
    const out = htmlToMarkdown('<p>keep</p><script>alert(1)</script><style>p{}</style><noscript>ns</noscript><iframe src="x"></iframe>');
    expect(out).toBe("keep");
    expect(out).not.toContain("alert");
  });
  test("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});

describe("webfetch schema", () => {
  test("rejects non url empty and missing", () => {
    expect(WebfetchToolArgsSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(WebfetchToolArgsSchema.safeParse({ url: "" }).success).toBe(false);
    expect(WebfetchToolArgsSchema.safeParse({}).success).toBe(false);
  });
  test("accepts https url", () => {
    expect(WebfetchToolArgsSchema.safeParse({ url: "https://example.com/a" }).success).toBe(true);
  });
});

describe("websearch schema", () => {
  test("rejects empty and missing query", () => {
    expect(WebsearchToolArgsSchema.safeParse({ query: "" }).success).toBe(false);
    expect(WebsearchToolArgsSchema.safeParse({}).success).toBe(false);
  });
  test("defaults deepness to 1 and clamps range", () => {
    expect(WebsearchToolArgsSchema.safeParse({ query: "hi" }).data?.deepness).toBe(1);
    expect(WebsearchToolArgsSchema.safeParse({ query: "hi", deepness: 0 }).success).toBe(false);
    expect(WebsearchToolArgsSchema.safeParse({ query: "hi", deepness: 6 }).success).toBe(false);
    expect(WebsearchToolArgsSchema.safeParse({ query: "hi", deepness: 5 }).success).toBe(true);
  });
});

describe("assertSafeUrl edges", () => {
  test("blocks 10.x and 192.168 ranges", () => {
    expect(() => assertSafeUrl("http://10.0.0.1/x")).toThrow("private");
    expect(() => assertSafeUrl("http://10.255.255.255/x")).toThrow("private");
    expect(() => assertSafeUrl("http://192.168.0.1/x")).toThrow("private");
    expect(() => assertSafeUrl("http://192.168.1.1/x")).toThrow("private");
  });
  test("blocks 172.16-31 but allows 172.15 and 172.32", () => {
    expect(() => assertSafeUrl("http://172.16.0.1/x")).toThrow("private");
    expect(() => assertSafeUrl("http://172.31.255.255/x")).toThrow("private");
    expect(assertSafeUrl("http://172.32.0.1/x").hostname).toBe("172.32.0.1");
    expect(assertSafeUrl("http://172.15.0.1/x").hostname).toBe("172.15.0.1");
  });
  test("blocks localhost and its subdomains", () => {
    expect(() => assertSafeUrl("http://localhost/x")).toThrow("private");
    expect(() => assertSafeUrl("http://LOCALHOST/x")).toThrow("private");
    expect(() => assertSafeUrl("http://foo.localhost/x")).toThrow("private");
    expect(() => assertSafeUrl("http://sub.localhost/x")).toThrow("private");
    expect(() => assertSafeUrl("http://localhost:3000/x")).toThrow("private");
  });
  test("blocks loopback unspecified and metadata hosts", () => {
    expect(() => assertSafeUrl("http://127.5.6.7/x")).toThrow("private");
    expect(() => assertSafeUrl("http://0.0.0.0/x")).toThrow("private");
    expect(() => assertSafeUrl("http://[::1]/x")).toThrow("private");
    expect(() => assertSafeUrl("http://169.254.10.20/x")).toThrow("private");
  });
  test("allowPrivate flag bypasses host check", () => {
    expect(assertSafeUrl("http://10.1.2.3/x", true).hostname).toBe("10.1.2.3");
    expect(assertSafeUrl("http://foo.localhost/x", true).hostname).toBe("foo.localhost");
    expect(assertSafeUrl("http://172.16.0.1/x", true).hostname).toBe("172.16.0.1");
  });
  test("rejects invalid urls and non http protocols", () => {
    expect(() => assertSafeUrl("nota-url")).toThrow("invalid");
    expect(() => assertSafeUrl("ftp://example.com/x")).toThrow("protocol");
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow("protocol");
  });
  test("allows public http and https", () => {
    expect(assertSafeUrl("https://example.com/x").hostname).toBe("example.com");
    expect(assertSafeUrl("http://example.com/x").hostname).toBe("example.com");
  });
});

describe("fetchAsMarkdown guards", () => {
  test("rejects private host without launching browser", async () => {
    await expect(fetchAsMarkdown("http://127.0.0.1/x")).rejects.toThrow("private");
  });
  test("rejects invalid url without launching browser", async () => {
    await expect(fetchAsMarkdown("nota-url")).rejects.toThrow("invalid");
  });
});

describe("parseSearchPage extras", () => {
  test("ignores snippet with no preceding result", () => {
    const html = `<a class="result__snippet" href="x">orphan</a><a class="result__a" href="https://a.example/">A</a>`;
    const parsed = parseSearchPage(html);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.url).toBe("https://a.example/");
  });
  test("takes max next offset across encodings", () => {
    const html = `<a class="result__a" href="https://a.example/">A</a><a href="?s=10">n</a><a href="?s=30&amp;s=20">m</a>`;
    expect(parseSearchPage(html).nextOffset).toBe(30);
  });
  test("returns null offset when no pagination", () => {
    const html = `<a class="result__a" href="https://a.example/">A</a>`;
    expect(parseSearchPage(html).nextOffset).toBeNull();
  });
  test("decodes entities before reading uddg", () => {
    expect(resolveDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x")).toBe("https://example.com/a");
  });
});
