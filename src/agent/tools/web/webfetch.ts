import { assertSafeUrl, renderPage } from "@agent/tools/web/browser.ts";
import { htmlToMarkdown } from "@agent/tools/web/html-to-markdown.ts";
import z from "zod";
export const WebfetchToolArgsSchema = z.object({
  url: z.string().url(),
});
export const WebfetchToolOutputSchema = z.object({
  url: z.string(),
  contentType: z.string(),
  content: z.string(),
});

export const WebfetchProgressSchema = z.object({
  progress: z.string(),
});

export const WebfetchStreamChunkSchema = z.union([WebfetchToolOutputSchema, WebfetchProgressSchema]);

export async function fetchAsMarkdown(url: string, opts: { timeout?: number; allowPrivate?: boolean } = {}): Promise<z.infer<typeof WebfetchToolOutputSchema>> {
  assertSafeUrl(url, opts.allowPrivate ?? false);
  let rendered: Awaited<ReturnType<typeof renderPage>>;
  try {
    rendered = await renderPage(url, opts);
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (rendered.status >= 400) throw new Error(`Request to ${rendered.url} failed with HTTP ${rendered.status}`);
  const isHtml = rendered.contentType === "text/html" || rendered.contentType === "application/xhtml+xml";
  const content = isHtml ? htmlToMarkdown(rendered.body) : rendered.body;
  return { url: rendered.url, contentType: rendered.contentType, content };
}

export const webfetchTool = {
  name: "webfetch",
  description:
    "Fetches a URL over HTTP(S) and returns its contents as Markdown. HTML pages are converted to Markdown; other content types are returned as-is (they may already be Markdown or plain text).",
  parameters: WebfetchToolArgsSchema,
  output: WebfetchStreamChunkSchema,
  kind: "external" as const,
  handler: async function* (args: z.infer<typeof WebfetchToolArgsSchema>): AsyncGenerator<z.infer<typeof WebfetchStreamChunkSchema>> {
    yield { progress: "Rendering in headless Chrome…" };
    const result = await fetchAsMarkdown(args.url);
    yield result;
  },
};
