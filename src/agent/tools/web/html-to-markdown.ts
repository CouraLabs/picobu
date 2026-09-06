import TurndownService from "turndown";


const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript", "iframe"]);


export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}
