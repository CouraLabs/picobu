import z from "zod";
import { htmlToMarkdown } from "@harness/agent/tool/external/html-to-markdown.ts";
import { renderPage } from "@harness/agent/tool/external/browser.ts";

export const WebfetchToolArgsSchema = z.object({
  url: z.string().url(),
});

export const WebfetchToolOutputSchema = z.object({
  url: z.string(),
  contentType: z.string(),
  content: z.string(),
});

/** Preliminary chunk yielded while the fetch runs (streamed to the UI live). */
export const WebfetchProgressSchema = z.object({
  progress: z.string(),
});

/** What the handler yields: progress notes while running, then the full result. */
export const WebfetchStreamChunkSchema = z.union([
  WebfetchToolOutputSchema,
  WebfetchProgressSchema,
]);

/**
 * Fetch a URL with headless Chrome (so JavaScript executes) and return its
 * contents as Markdown: HTML bodies are captured after rendering and converted
 * with turndown; any other content type is returned verbatim (it may already
 * be Markdown or plain text).
 */
export async function fetchAsMarkdown(url: string): Promise<z.infer<typeof WebfetchToolOutputSchema>> {
  let rendered: Awaited<ReturnType<typeof renderPage>>;
  try {
    rendered = await renderPage(url);
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
  handler: async function* (
    args: z.infer<typeof WebfetchToolArgsSchema>,
  ): AsyncGenerator<z.infer<typeof WebfetchStreamChunkSchema>> {
    // The headless-Chrome render can take seconds; report it before starting so
    // the UI has feedback right away.
    yield { progress: "Rendering in headless Chrome…" };
    const result = await fetchAsMarkdown(args.url);
    yield result;
  },
};
