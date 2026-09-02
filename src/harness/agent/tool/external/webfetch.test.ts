import { describe, expect, test } from "bun:test";
import z from "zod";
import {
  fetchAsMarkdown,
  WebfetchProgressSchema,
  WebfetchToolArgsSchema,
  WebfetchToolOutputSchema,
  webfetchTool,
} from "./webfetch";

describe("webfetch", () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/page") {
        return new Response("<h1>Hello</h1><p>Some <b>bold</b> text</p>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === "/js") {
        return new Response(
          "<h1></h1><script>document.querySelector('h1').textContent = 'Rendered by JavaScript';</script>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (url.pathname === "/raw.md") {
        return new Response("# Already markdown\n\n- one\n- two", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      return new Response("nope", { status: 404 });
    },
  });

  test("args schema requires a valid url", () => {
    const args = { url: "https://example.com/page" } satisfies z.infer<typeof WebfetchToolArgsSchema>;
    expect(WebfetchToolArgsSchema.safeParse(args).success).toBe(true);
    expect(WebfetchToolArgsSchema.safeParse({ url: "not a url" }).success).toBe(false);
  });

  test("converts an HTML response body to markdown", async () => {
    const result = await fetchAsMarkdown(`${server.url.href}page`);
    expect(result.contentType).toBe("text/html");
    expect(result.content).toBe("# Hello\n\nSome **bold** text");
  });

  test("executes JavaScript before capturing content", async () => {
    const result = await fetchAsMarkdown(`${server.url.href}js`);
    expect(result.content).toBe("# Rendered by JavaScript");
  });

  test("returns non-HTML content verbatim (it may already be markdown)", async () => {
    const result = await fetchAsMarkdown(`${server.url.href}raw.md`);
    expect(result.contentType).toBe("text/plain");
    expect(result.content).toBe("# Already markdown\n\n- one\n- two");
  });

  test("throws with the HTTP status for error responses", async () => {
    expect(fetchAsMarkdown(`${server.url.href}missing`)).rejects.toThrow("HTTP 404");
  });

  test("handler streams progress first, then the full result", async () => {
    const chunks: (z.infer<typeof WebfetchProgressSchema> | z.infer<typeof WebfetchToolOutputSchema>)[] = [];
    for await (const chunk of webfetchTool.handler({ url: `${server.url.href}page` })) {
      chunks.push(chunk);
    }
    // at least one progress note precedes the final output
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toEqual({ progress: "Rendering in headless Chrome…" });
    const last = chunks[chunks.length - 1];
    expect(last).toMatchObject({ url: `${server.url.href}page`, contentType: "text/html" });
  });
});
