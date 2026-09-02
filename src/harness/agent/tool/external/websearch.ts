import z from "zod";
import { htmlToMarkdown } from "./html-to-markdown";
import { fetchAsMarkdown } from "./webfetch";
import { renderPage } from "./browser";

export const WebsearchToolArgsSchema = z.object({
  query: z.string().min(1),
  /** Amount of DuckDuckGo result pages to look through (1-5). */
  deepness: z.number().min(1).max(5).default(1),
});

export const WebsearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  /** Markdown content of the linked page; `null` when the fetch failed. */
  content: z.string().nullable(),
});

export const WebsearchToolOutputSchema = z.object({
  query: z.string(),
  results: z.array(WebsearchResultSchema),
});

/** Preliminary chunk yielded while the search runs (streamed to the UI live). */
export const WebsearchProgressSchema = z.object({
  progress: z.string(),
  /** Results found so far, so the UI can render them as they arrive. */
  results: z.array(WebsearchResultSchema).optional(),
});

/** What the handler yields: progress notes while running, then the full result. */
export const WebsearchStreamChunkSchema = z.union([
  WebsearchToolOutputSchema,
  WebsearchProgressSchema,
]);

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";

/** One parsed DuckDuckGo result: title/url plus the optional next-page offset. */
export type ParsedSearchPage = {
  results: { title: string; url: string; snippet: string }[];
  nextOffset: number | null;
};

/** Decode `&amp;` and friends so URL parsing sees raw characters. */
function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");
}

/** Resolve a DuckDuckGo redirect href (`//duckduckgo.com/l/?uddg=<enc>`) to the target URL. */
export function resolveDdgHref(href: string): string | null {
  try {
    const url = new URL(decodeEntities(href), SEARCH_ENDPOINT);
    const uddg = url.searchParams.get("uddg");
    return uddg ?? url.toString();
  } catch {
    return null;
  }
}

/**
 * Parse a DuckDuckGo HTML results page: every `result__a` anchor becomes a
 * result (title HTML converted to Markdown via turndown) and every
 * `result__snippet` anchor pairs by index. Also extracts the next `s` offset
 * from the pagination link, or `null` when there is none.
 */
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

  // Pagination: the next-page link carries an `s=<offset>` query param (the
  // `&` may be HTML-entity-encoded as `&amp;` in the raw markup).
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

    // Fetch each link found across the `deepness` pages via webfetch; failures
    // degrade to `content: null` so one bad link doesn't sink the search.
    // Links are fetched in bounded batches (renderPage caps concurrent pages
    // too): strictly-sequential fetching made deep searches take minutes with
    // no visible progress.
    const total = results.length;
    const FETCH_CONCURRENCY = 4;
    for (let i = 0; i < total; i += FETCH_CONCURRENCY) {
      const batch = results.slice(i, i + FETCH_CONCURRENCY);
      yield {
        progress: `Fetching results ${i + 1}–${i + batch.length} of ${total}…`,
        results: snapshot(),
      };
      await Promise.all(
        batch.map(async (result) => {
          try {
            const fetchedPage = await fetchAsMarkdown(result.url);
            result.content = fetchedPage.content;
          } catch {
            result.content = null;
          }
        }),
      );
      yield { progress: `Fetched ${Math.min(i + FETCH_CONCURRENCY, total)} of ${total}…`, results: snapshot() };
    }

    yield { query: args.query, results };
  },
};
