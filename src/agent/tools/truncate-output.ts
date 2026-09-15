import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { options } from '@config/options.ts'

export const MAX_TOOL_OUTPUT_CHARS = 50000
export const TOOL_OUTPUT_TRUNCATION_SUFFIX = '\n…[truncated at 50000 chars — re-read in smaller chunks if needed]'

export const MAX_TOOL_OUTPUT_LINES = 2000
export const MAX_TOOL_OUTPUT_BYTES = 50 * 1024
const TRUNCATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

const truncateText = (text: string): string => (text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}${TOOL_OUTPUT_TRUNCATION_SUFFIX}` : text)

export const truncateToolOutput = (output: unknown): unknown => {
  if (typeof output === 'string') return truncateText(output)
  if (typeof output === 'object' && output !== null && !Array.isArray(output) && typeof (output as { content?: unknown }).content === 'string') {
    const source = output as { content: string }
    const content = truncateText(source.content)
    return content === source.content ? output : { ...source, content }
  }
  return output
}

export const toolOutputDir = (): string => join(options.app.systemDir, 'tool-output')

export const writeFullToolOutput = async (text: string): Promise<string> => {
  const dir = toolOutputDir()
  await mkdir(dir, { recursive: true })
  const name = `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.txt`
  const file = join(dir, name)
  await writeFile(file, text, 'utf8')
  return file
}

export const cleanupToolOutputs = async (): Promise<void> => {
  const cutoff = Date.now() - TRUNCATION_RETENTION_MS
  let entries: Array<string>
  try {
    entries = (await readdir(toolOutputDir())).filter((name) => name.startsWith('tool_'))
  } catch {
    return
  }
  for (const entry of entries) {
    const file = join(toolOutputDir(), entry)
    try {
      const info = await stat(file)
      if (info.mtimeMs < cutoff) await rm(file, { force: true })
    } catch {}
  }
}

export interface TailResult {
  text: string
  cut: boolean
}

export const tailText = (text: string, maxLines: number = MAX_TOOL_OUTPUT_LINES, maxBytes: number = MAX_TOOL_OUTPUT_BYTES): TailResult => {
  const lines = text.split('\n')
  if (lines.length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes) return { text, cut: false }
  const out: Array<string> = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const line = lines[i] ?? ''
    const size = Buffer.byteLength(line, 'utf-8') + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(line, 'utf-8')
        out.unshift(buf.subarray(Math.max(0, buf.length - maxBytes)).toString('utf-8'))
      }
      break
    }
    out.unshift(line)
    bytes += size
  }
  return { text: out.join('\n'), cut: true }
}

export const headText = (text: string, maxLines: number = MAX_TOOL_OUTPUT_LINES, maxBytes: number = MAX_TOOL_OUTPUT_BYTES): TailResult => {
  const lines = text.split('\n')
  if (lines.length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes) return { text, cut: false }
  const out: Array<string> = []
  let bytes = 0
  for (let i = 0; i < lines.length && out.length < maxLines; i++) {
    const line = lines[i] ?? ''
    const size = Buffer.byteLength(line, 'utf-8') + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) break
    out.push(line)
    bytes += size
  }
  return { text: out.join('\n'), cut: true }
}

export const truncationHint = (outputPath: string): string => `…output truncated…\n\nFull output saved to: ${outputPath}\nUse grep to search it or read with skip/limit to view sections.`

export interface SpilledTruncation {
  text: string
  truncated: boolean
  outputPath?: string
}

export const truncateTextWithSpill = async (text: string, opts: { maxLines?: number; maxBytes?: number; direction?: 'head' | 'tail' } = {}): Promise<SpilledTruncation> => {
  const maxLines = opts.maxLines ?? MAX_TOOL_OUTPUT_LINES
  const maxBytes = opts.maxBytes ?? MAX_TOOL_OUTPUT_BYTES
  if (text.split('\n').length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes) return { text, truncated: false }
  const preview = opts.direction === 'tail' ? tailText(text, maxLines, maxBytes).text : headText(text, maxLines, maxBytes).text
  const outputPath = await writeFullToolOutput(text)
  return { text: `${preview}\n\n${truncationHint(outputPath)}`, truncated: true, outputPath }
}

export const spillToolResult = async (output: unknown): Promise<unknown> => {
  if (typeof output === 'string') {
    const spilled = await truncateTextWithSpill(output, { direction: 'tail' })
    return spilled.truncated ? spilled.text : output
  }
  if (typeof output === 'object' && output !== null && !Array.isArray(output) && typeof (output as { content?: unknown }).content === 'string') {
    const source = output as { content: string }
    const spilled = await truncateTextWithSpill(source.content, { direction: 'head' })
    if (!spilled.truncated) return output
    return { ...source, content: spilled.text }
  }
  return truncateToolOutput(output)
}
