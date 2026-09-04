import { describe, expect, test } from "bun:test";
import { htmlToMarkdown } from "@agent/tools/web/html-to-markdown.ts";

describe("htmlToMarkdown", () => {
  test("converts headings, emphasis, and links", () => {
    expect(
      htmlToMarkdown("<h1>Title</h1><p>Hello <b>world</b>, see <a href='https://example.com'>this</a>.</p>"),
    ).toBe("# Title\n\nHello **world**, see [this](https://example.com).");
  });

  test("renders fenced code blocks", () => {
    expect(htmlToMarkdown("<pre><code>const a = 1;</code></pre>")).toBe("```\nconst a = 1;\n```");
  });

  test("strips script and style elements entirely", () => {
    expect(htmlToMarkdown("<p>keep</p><script>alert('x')</script><style>p{}</style>")).toBe("keep");
  });
});
