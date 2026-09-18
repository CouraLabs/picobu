import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { resolveInsideBase } from '@agent/tools/filesystem/paths.ts'
import { sandboxRoot } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { headText, MAX_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_LINES } from '@agent/tools/truncate-output.ts'
import { detectFiletype } from '@shared/filetype.ts'
import { withLock } from '@shared/lock.ts'
import z from 'zod'

const ReadToolOutputSchema = z.object({
  filetype: z.string(),
  content: z.string(),
})
export const ReadToolArgsSchema = z.object({
  path: z.string().min(1),
  skip: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
})
const MAX_READ_BYTES = 2_000_000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const SAMPLE_BYTES = 4096
const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.tar',
  '.gz',
  '.exe',
  '.dll',
  '.so',
  '.class',
  '.jar',
  '.war',
  '.7z',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.bin',
  '.dat',
  '.obj',
  '.o',
  '.a',
  '.lib',
  '.wasm',
  '.pyc',
  '.pyo',
])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico'])
const PDF_EXTENSION = '.pdf'
const cutLongLine = (line: string): string => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}${MAX_LINE_SUFFIX}` : line)
const sliceLines = (text: string, skip?: number, limit?: number): string => {
  const lines = text.split(/\r?\n/)
  const begin = (skip ?? 0) + 1
  const end = limit == null ? lines.length : begin + limit - 1
  return lines
    .slice(Math.max(begin - 1, 0), Math.min(end, lines.length))
    .map((line) => cutLongLine(line.replace(/\r$/, '')))
    .join('\n')
}
const isBinarySample = (path: string, sample: Uint8Array): boolean => {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return true
  if (sample.length === 0) return false
  let nonPrintable = 0
  for (const byte of sample) {
    if (byte === 0) return true
    if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++
  }
  return nonPrintable / sample.length > 0.3
}
const suggestSimilar = async (path: string): Promise<Array<string>> => {
  const dir = dirname(path)
  const base = basename(path).toLowerCase()
  try {
    const entries = await readdir(dir)
    return entries
      .filter((entry) => entry.toLowerCase().includes(base) || base.includes(entry.toLowerCase()))
      .map((entry) => join(dir, entry))
      .slice(0, 3)
  } catch {
    return []
  }
}
export const readTool = {
  name: 'read',
  description:
    'Read a file (skip/limit slice lines) or list a directory. Rejects binary files; images/PDFs return metadata only. Long lines cut at 2000 chars, output capped near 50KB — re-read with skip/limit to continue.',
  parameters: ReadToolArgsSchema,
  output: ReadToolOutputSchema,
  defer: 'auto',
  handler: async (args: z.infer<typeof ReadToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof ReadToolOutputSchema>> => {
    if (!args.path) throw new Error('read requires a non-empty path')
    const base = sandboxRoot(toolOptions?.experimental_sandbox)
    const path = await resolveInsideBase(base, args.path)
    return withLock(path, async () => {
      let info: Awaited<ReturnType<typeof stat>> | undefined
      try {
        info = await stat(path)
      } catch {
        info = undefined
      }
      if (!info) {
        const hints = await suggestSimilar(path)
        if (hints.length > 0) throw new Error(`File not found: ${path}\n\nDid you mean one of these?\n${hints.join('\n')}`)
        throw new Error(`File not found: ${path}`)
      }
      if (info.isDirectory()) {
        const entries = (await readdir(path)).sort((a, b) => a.localeCompare(b))
        const skip = args.skip ?? 0
        const sliced = args.limit == null ? entries.slice(skip) : entries.slice(skip, skip + args.limit)
        const truncated = skip + sliced.length < entries.length
        const body = sliced.join('\n')
        const footer = truncated ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use skip=${skip + sliced.length} to continue.)` : `\n(${entries.length} entries)`
        return { filetype: 'directory', content: `${body}${body.length > 0 ? footer : `(${entries.length} entries)`}` }
      }
      const file = Bun.file(path)
      const lower = path.toLowerCase()
      const dot = lower.lastIndexOf('.')
      const ext = dot >= 0 ? lower.slice(dot) : ''
      if (IMAGE_EXTENSIONS.has(ext) || ext === PDF_EXTENSION) {
        const kind = ext === PDF_EXTENSION ? 'PDF' : 'Image'
        return {
          filetype: detectFiletype(path),
          content: `${kind} file at ${path} (${info.size.toLocaleString()} bytes) — binary content not inlined. Convert or describe it with shell tools if needed.`,
        }
      }
      try {
        const sample = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer())
        if (isBinarySample(path, sample)) throw new Error(`Cannot read binary file: ${path}`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Cannot read binary file')) throw error
      }
      if (file.size > MAX_READ_BYTES && args.skip == null && args.limit == null) {
        throw new Error(`File is ${file.size.toLocaleString()} bytes; pass skip and limit to read it in parts`)
      }
      const readSlice = async (): Promise<{ content: string; totalLines: number }> => {
        if (file.size <= MAX_READ_BYTES) {
          const raw = await file.text()
          const totalLines = raw.length === 0 ? 0 : raw.split(/\r?\n/).length
          return { content: sliceLines(raw, args.skip, args.limit), totalLines }
        }
        const begin = (args.skip ?? 0) + 1
        const end = args.limit == null ? Number.MAX_SAFE_INTEGER : begin + args.limit - 1
        const stream = file.stream()
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let lineIndex = 0
        let pending = ''
        const wanted: Array<string> = []
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            pending += decoder.decode(chunk.value, { stream: true })
            const parts = pending.split('\n')
            pending = parts.pop() ?? ''
            for (const part of parts) {
              lineIndex += 1
              if (lineIndex >= begin && lineIndex <= end) wanted.push(cutLongLine(part.replace(/\r$/, '')))
              if (lineIndex >= end) break
            }
            if (lineIndex >= end) break
            if (wanted.join('\n').length > MAX_READ_BYTES) break
          }
          if (lineIndex < end && pending.length > 0) {
            lineIndex += 1
            if (lineIndex >= begin && lineIndex <= end) wanted.push(cutLongLine(pending.replace(/\r$/, '')))
          }
        } finally {
          reader.releaseLock()
        }
        return { content: wanted.join('\n'), totalLines: lineIndex }
      }
      const { content, totalLines } = await readSlice()
      if (totalLines > 0 && (args.skip ?? 0) >= totalLines && !(totalLines === 0 && (args.skip ?? 0) === 0)) {
        throw new Error(`skip ${args.skip} is out of range for this file (${totalLines} lines)`)
      }
      if (Buffer.byteLength(content, 'utf-8') > MAX_TOOL_OUTPUT_BYTES || content.split('\n').length > MAX_TOOL_OUTPUT_LINES) {
        const preview = headText(content, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES).text
        const shown = args.limit == null ? preview.split('\n').length : Math.min(args.limit, preview.split('\n').length)
        const begin = (args.skip ?? 0) + 1
        return {
          filetype: detectFiletype(path),
          content: `${preview}\n\n(Output capped near 50KB. Showing from line ${begin}; re-read with skip=${begin - 1 + shown} to continue.)`,
        }
      }
      return { filetype: detectFiletype(path), content }
    })
  },
}
