import z from "zod";
import { htmlToMarkdown } from "../html-to-markdown";
import { renderPage } from "../browser";

export const WebfetchToolArgsSchema = z.object({
  url: z.string().url(),
});

export const WebfetchToolOutputSchema = z.object({
  url: z.string(),
  contentType: z.string(),
  content: z.string(),
});

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
  output: WebfetchToolOutputSchema,
  kind: "external" as const,
  handler: async (
    args: z.infer<typeof WebfetchToolArgsSchema>,
  ): Promise<z.infer<typeof WebfetchToolOutputSchema>> => {
    return fetchAsMarkdown(args.url);
  },
};
