import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { assertSafeUrl, renderPage } from '@agent/tools/web/browser.ts'
import { extractTextFromHtml, htmlToMarkdown } from '@agent/tools/web/html-to-markdown.ts'
import z from 'zod'
export const WebfetchToolArgsSchema = z.object({
  url: z.string().url(),
  format: z.enum(['text', 'markdown', 'html']).optional().default('markdown').describe('Response format (default markdown).'),
  timeout: z.number().int().min(1).max(120).optional().describe('Timeout in seconds (max 120, default 30).'),
  useBrowser: z.boolean().optional().describe('Force headless-Chrome rendering instead of fast HTTP fetch.'),
})
export const WebfetchToolOutputSchema = z.object({
  url: z.string(),
  contentType: z.string(),
  content: z.string(),
})

export const WebfetchProgressSchema = z.object({
  progress: z.string(),
})

export const WebfetchStreamChunkSchema = z.union([WebfetchToolOutputSchema, WebfetchProgressSchema])

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const acceptForFormat = (format: 'text' | 'markdown' | 'html'): string => {
  switch (format) {
    case 'text':
      return 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
    case 'html':
      return 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1'
    default:
      return 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
  }
}

const looksLikeJsShell = (body: string): boolean => {
  const trimmed = body.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length > 20_000) return false
  return /just a moment|cf-challenge|__NEXT_DATA__|id="root"[^>]*><\/div>|enable javascript/i.test(trimmed) && htmlToMarkdown(trimmed).length < 200
}

const fetchDirect = async (
  url: string,
  format: 'text' | 'markdown' | 'html',
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<{ url: string; contentType: string; content: string } | undefined> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  abortSignal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: acceptForFormat(format), 'accept-language': 'en-US,en;q=0.9' },
      signal: abortSignal ? AbortSignal.any([controller.signal, abortSignal]) : controller.signal,
      redirect: 'follow',
    })
    if (!response.ok) {
      if (response.status === 403) return undefined
      throw new Error(`HTTP ${response.status}`)
    }
    const length = response.headers.get('content-length')
    if (length && Number(length) > MAX_RESPONSE_BYTES) throw new Error('Response too large (exceeds 5MB limit)')
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error('Response too large (exceeds 5MB limit)')
    const rawContentType = response.headers.get('content-type') ?? ''
    const mime = rawContentType.split(';')[0]?.trim().toLowerCase() || ''
    if (mime.startsWith('image/')) {
      return { url: response.url || url, contentType: mime, content: `Image at ${url} (${mime}, ${buffer.byteLength.toLocaleString()} bytes) — binary content not inlined.` }
    }
    const body = new TextDecoder().decode(buffer)
    const isHtml = mime === '' || mime.includes('text/html') || mime.includes('application/xhtml')
    if (!isHtml) return { url: response.url || url, contentType: mime || 'text/plain', content: body }
    if (format === 'html') return { url: response.url || url, contentType: mime || 'text/html', content: body }
    if (format === 'text') return { url: response.url || url, contentType: mime || 'text/html', content: extractTextFromHtml(body) }
    if (looksLikeJsShell(body)) return undefined
    return { url: response.url || url, contentType: mime || 'text/html', content: htmlToMarkdown(body) }
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('HTTP') || error.message.startsWith('Response too large'))) throw error
    return undefined
  } finally {
    clearTimeout(timer)
    abortSignal?.removeEventListener('abort', onAbort)
  }
}

export async function fetchAsMarkdown(
  url: string,
  opts: { timeout?: number; allowPrivate?: boolean; format?: 'text' | 'markdown' | 'html'; useBrowser?: boolean; signal?: AbortSignal } = {},
): Promise<z.infer<typeof WebfetchToolOutputSchema>> {
  opts.signal?.throwIfAborted()
  assertSafeUrl(url, opts.allowPrivate ?? false)
  const format = opts.format ?? 'markdown'
  const timeoutMs = Math.min((opts.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, 120_000)
  if (!opts.useBrowser) {
    const direct = await fetchDirect(url, format, timeoutMs, opts.signal).catch(() => undefined)
    if (direct) return direct
  }
  opts.signal?.throwIfAborted()
  let rendered: Awaited<ReturnType<typeof renderPage>>
  try {
    rendered = await renderPage(url, { timeout: timeoutMs, allowPrivate: opts.allowPrivate })
  } catch (error) {
    if (opts.signal?.aborted) throw new Error('Fetch aborted')
    throw new Error(`Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (rendered.status >= 400) throw new Error(`Request to ${rendered.url} failed with HTTP ${rendered.status}`)
  const isHtml = rendered.contentType === 'text/html' || rendered.contentType === 'application/xhtml+xml'
  if (!isHtml) return { url: rendered.url, contentType: rendered.contentType, content: rendered.body }
  if (format === 'html') return { url: rendered.url, contentType: rendered.contentType, content: rendered.body }
  if (format === 'text') return { url: rendered.url, contentType: rendered.contentType, content: extractTextFromHtml(rendered.body) }
  return { url: rendered.url, contentType: rendered.contentType, content: htmlToMarkdown(rendered.body) }
}

export const webfetchTool = {
  name: 'webfetch',
  description: 'Fetch a URL as Markdown (fast HTTP first, headless Chrome fallback). Use format text/markdown/html and timeout up to 120s.',
  parameters: WebfetchToolArgsSchema,
  output: WebfetchStreamChunkSchema,
  kind: 'external' as const,
  handler: async function* (args: z.infer<typeof WebfetchToolArgsSchema>, toolOptions?: ToolExecuteOptions): AsyncGenerator<z.infer<typeof WebfetchStreamChunkSchema>> {
    yield { progress: 'Fetching URL…' }
    const result = await fetchAsMarkdown(args.url, { format: args.format ?? 'markdown', timeout: args.timeout, useBrowser: args.useBrowser, signal: toolOptions?.abortSignal })
    yield result
  },
}
