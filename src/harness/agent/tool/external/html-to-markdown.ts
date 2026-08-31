import TurndownService from "turndown";

/** Shared turndown instance: ATX headings, fenced code, script/style dropped. */
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript", "iframe"]);

/** Convert an HTML string to Markdown. Non-HTML input passes through untouched. */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}
