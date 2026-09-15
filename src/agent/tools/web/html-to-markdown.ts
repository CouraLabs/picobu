import TurndownService from 'turndown'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
turndown.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'meta', 'link'])

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim()
}

export function extractTextFromHtml(html: string): string {
  const withoutSkipped = html.replace(/<(script|style|noscript|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  const withoutTags = withoutSkipped.replace(/<[^>]*>/g, ' ')
  return withoutTags
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
