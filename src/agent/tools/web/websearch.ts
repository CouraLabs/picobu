import z from "zod";
import { htmlToMarkdown } from "@agent/tools/web/html-to-markdown.ts";
import { fetchAsMarkdown } from "@agent/tools/web/webfetch.ts";
import { renderPage } from "@agent/tools/web/browser.ts";
export const WebsearchToolArgsSchema = z.object({
  query: z.string().min(1),
  deepness: z.number().min(1).max(5).default(1),
});
export const WebsearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  content: z.string().nullable(),
});
export const WebsearchToolOutputSchema = z.object({
  query: z.string(),
  results: z.array(WebsearchResultSchema),
});


export const WebsearchProgressSchema = z.object({
  progress: z.string(),
  results: z.array(WebsearchResultSchema).optional(),
});


export const WebsearchStreamChunkSchema = z.union([
  WebsearchToolOutputSchema,
  WebsearchProgressSchema,
]);
const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";


export type ParsedSearchPage = {
  results: { title: string; url: string; snippet: string }[];
  nextOffset: number | null;
};


function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");
}


export function resolveDdgHref(href: string): string | null {
  try {
    const url = new URL(decodeEntities(href), SEARCH_ENDPOINT);
    const uddg = url.searchParams.get("uddg");
    return uddg ?? url.toString();
  } catch {
    return null;
  }
}


export function parseSearchPage(html: string): ParsedSearchPage {
  const titles: { title: string; url: string }[] = [];
  const snippets: string[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(anchorRe)) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    if (/class="[^"]*\bresult__a\b/.test(attrs)) {
      const href = /href="([^"]*)"/.exec(attrs)?.[1];
      const url = href ? resolveDdgHref(href) : null;
      if (!url) continue;
      titles.push({ title: htmlToMarkdown(inner).replaceAll("\n", " "), url });
    } else if (/class="[^"]*\bresult__snippet\b/.test(attrs)) {
      snippets.push(htmlToMarkdown(inner).replaceAll("\n", " "));
    }
  }
  const results = titles.map((t, i) => ({
    title: t.title,
    url: t.url,
    snippet: snippets[i] ?? "",
  }));

  
  
  let nextOffset: number | null = null;
  for (const match of html.matchAll(/[?&](?:amp;)?s=(\d+)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) nextOffset = Math.max(nextOffset ?? 0, value);
  }
  return { results, nextOffset };
}
export const websearchTool = {
  name: "websearch",
  description:
    "Searches the web with DuckDuckGo's HTML endpoint. `deepness` controls how many result pages to look through; every link found across those pages is fetched and its page content is returned as Markdown alongside each result.",
  parameters: WebsearchToolArgsSchema,
  output: WebsearchStreamChunkSchema,
  kind: "external" as const,
  handler: async function* (
    args: z.infer<typeof WebsearchToolArgsSchema>,
  ): AsyncGenerator<z.infer<typeof WebsearchStreamChunkSchema>> {
    const seen = new Set<string>();
    const results: z.infer<typeof WebsearchResultSchema>[] = [];
    const snapshot = () => results.map((r) => ({ ...r }));
    let offset: number | null = null;
    let pages = 0;
    yield { progress: `Searching "${args.query}"…` };
    for (let page = 0; page < args.deepness; page++) {
      const searchUrl = new URL(SEARCH_ENDPOINT);
      searchUrl.searchParams.set("q", args.query);
      if (offset !== null) searchUrl.searchParams.set("s", String(offset));
      let html: string;
      try {
        const rendered = await renderPage(searchUrl.toString());
        if (rendered.status >= 400) throw new Error(`HTTP ${rendered.status}`);
        html = rendered.body;
      } catch (error) {
        throw new Error(
          `DuckDuckGo search failed for "${args.query}" (page ${page + 1}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      pages++;
      const parsed = parseSearchPage(html);
      for (const result of parsed.results) {
        if (seen.has(result.url)) continue;
        seen.add(result.url);
        results.push({ ...result, content: null });
      }
      yield { progress: `Page ${pages}: ${results.length} result${results.length === 1 ? "" : "s"}`, results: snapshot() };
      if (parsed.nextOffset === null) break;
      offset = parsed.nextOffset;
    }

    
    
    
    
    
    // Fetch page content with a sliding window of concurrent renders. Each
    // launch and each completion emits a progress chunk so the UI shows
    // continuous activity — a batch-wide Promise.all would go silent for the
    // whole window, which on slow sites can be tens of seconds.
    const total = results.length;
    const FETCH_CONCURRENCY = 4;
    // Content enrichment is best-effort; cap each page well below renderPage's
    // 30s default so one hung page can't stall a whole concurrency window.
    const FETCH_TIMEOUT_MS = 15_000;
    const hostOf = (url: string): string => {
      try {
        return new URL(url).host.replace(/^www\./, "");
      } catch {
        return url;
      }
    };
    let completed = 0;
    type Slot = { promise: Promise<void>; done: boolean };
    const slots: Slot[] = [];
    const launch = (result: z.infer<typeof WebsearchResultSchema>): Slot => {
      const slot: Slot = { promise: Promise.resolve(), done: false };
      slot.promise = (async () => {
        try {
          result.content = (await fetchAsMarkdown(result.url, { timeout: FETCH_TIMEOUT_MS })).content;
        } catch {
          result.content = null;
        } finally {
          slot.done = true;
          completed++;
        }
      })();
      return slot;
    };
    const reapSettled = (): void => {
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i]?.done) slots.splice(i, 1);
      }
    };
    for (const [i, result] of results.entries()) {
      if (slots.length >= FETCH_CONCURRENCY) {
        await Promise.race(slots.map((s) => s.promise));
        reapSettled();
        yield { progress: `Fetched ${completed} of ${total} pages`, results: snapshot() };
      }
      yield { progress: `Fetching page ${i + 1} of ${total} (${hostOf(result.url)})…`, results: snapshot() };
      slots.push(launch(result));
    }
    while (slots.length > 0) {
      await Promise.race(slots.map((s) => s.promise));
      reapSettled();
      yield { progress: `Fetched ${completed} of ${total} pages`, results: snapshot() };
    }
    yield { query: args.query, results };
  },
};
