import { describe, expect, test } from "bun:test";
import { parseSearchPage, resolveDdgHref, WebsearchToolArgsSchema } from "@harness/agent/tool/external/websearch.ts";

const PAGE_HTML = `
<div class="results">
  <div class="result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">Example <b>Alpha</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">First snippet</a>
  </div>
  <div class="result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb&amp;rut=def">Second &amp; last</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb&amp;rut=def">Second snippet</a>
  </div>
</div>
<div class="nav-link"><form action="/html/"><a href="https://duckduckgo.com/html/?q=test&amp;s=25&amp;dc=26&amp;o=json">Next</a></form></div>
`;

describe("resolveDdgHref", () => {
  test("decodes the uddg redirect parameter", () => {
    expect(resolveDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc")).toBe(
      "https://example.com/a",
    );
  });

  test("passes through direct urls", () => {
    expect(resolveDdgHref("https://example.com/direct")).toBe("https://example.com/direct");
  });

  test("returns null for unparseable hrefs", () => {
    expect(resolveDdgHref("http://")).toBe(null);
  });
});

describe("parseSearchPage", () => {
  test("extracts title, url, and markdown snippet for every result", () => {
    const parsed = parseSearchPage(PAGE_HTML);
    expect(parsed.results.length).toBe(2);
    expect(parsed.results[0]).toEqual({
      title: "Example **Alpha**",
      url: "https://example.com/a",
      snippet: "First snippet",
    });
    expect(parsed.results[1]).toEqual({
      title: "Second & last",
      url: "https://example.org/b",
      snippet: "Second snippet",
    });
  });

  test("extracts the next pagination offset", () => {
    expect(parseSearchPage(PAGE_HTML).nextOffset).toBe(25);
  });

  test("reports no offset when the page has no pagination link", () => {
    const parsed = parseSearchPage('<a class="result__a" href="https://example.com/x">X</a>');
    expect(parsed.results[0]).toEqual({ title: "X", url: "https://example.com/x", snippet: "" });
    expect(parsed.nextOffset).toBe(null);
  });
});

describe("websearch args", () => {
  test("deepness defaults to 1 and is bounded", () => {
    const parsed = WebsearchToolArgsSchema.parse({ query: "bun runtime" });
    expect(parsed.deepness).toBe(1);
    expect(WebsearchToolArgsSchema.safeParse({ query: "x", deepness: 6 }).success).toBe(false);
    expect(WebsearchToolArgsSchema.safeParse({ deepness: 1 }).success).toBe(false);
  });
});
