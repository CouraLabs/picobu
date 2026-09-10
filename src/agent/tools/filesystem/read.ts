import { isAbsolute, relative, resolve } from 'node:path'
import { sandboxRoot } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { detectFiletype } from '@shared/filetype.ts'
import { withLock } from '@shared/lock.ts'
import z from 'zod'

const ReadToolOutputSchema = z.object({
  filetype: z.string(),
  content: z.string(),
})
export const ReadToolArgsSchema = z.object({
  path: z.string().min(1),
  fromLine: z.number().min(1).nullable(),
  toLine: z.number().min(1).nullable(),
})
const MAX_READ_BYTES = 2_000_000
const resolveInsideBase = (base: string | undefined, userPath: string): string => {
  const resolved = resolve(base ?? process.cwd(), userPath)
  if (!base) return resolved
  const normalizedBase = resolve(base)
  const rel = relative(normalizedBase, resolved)
  if (rel !== '' && (rel === '..' || rel.startsWith('../') || isAbsolute(rel))) {
    throw new Error(`Path escapes working directory: ${userPath}`)
  }
  return resolved
}
const sliceLines = (text: string, fromLine: number | null, toLine: number | null): string => {
  const lines = text.split(/\r?\n/)
  if (fromLine != null && toLine != null && fromLine > toLine) {
    throw new Error(`fromLine (${fromLine}) cannot be greater than toLine (${toLine})`)
  }
  const begin = fromLine ?? 1
  const end = toLine ?? lines.length
  return lines.slice(Math.max(begin - 1, 0), Math.min(end, lines.length)).join('\n')
}
export const readTool = {
  name: 'read',
  description: 'Read a file, optionally sliced by fromLine/toLine.',
  parameters: ReadToolArgsSchema,
  output: ReadToolOutputSchema,
  defer: 'auto',
  handler: async (args: z.infer<typeof ReadToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof ReadToolOutputSchema>> => {
    if (!args.path) throw new Error('read requires a non-empty path')
    const base = sandboxRoot(toolOptions?.experimental_sandbox)
    const path = resolveInsideBase(base, args.path)
    return withLock(path, async () => {
      const file = Bun.file(path)
      if (!(await file.exists())) throw new Error(`File not found: ${path}`)
      if (file.size > MAX_READ_BYTES && args.fromLine == null && args.toLine == null) {
        throw new Error(`File is ${(file.size).toLocaleString()} bytes; pass fromLine and toLine to read it in parts`)
      }
      if (file.size <= MAX_READ_BYTES) {
        const text = await file.text()
        return { filetype: detectFiletype(path), content: sliceLines(text, args.fromLine, args.toLine) }
      }
      const begin = args.fromLine ?? 1
      const end = args.toLine ?? Number.MAX_SAFE_INTEGER
      if (begin > end) throw new Error(`fromLine (${begin}) cannot be greater than toLine (${end})`)
      const stream = file.stream()
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let lineIndex = 0
      let pending = ''
      const wanted: string[] = []
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          pending += decoder.decode(chunk.value, { stream: true })
          const parts = pending.split('\n')
          pending = parts.pop() ?? ''
          for (const part of parts) {
            lineIndex += 1
            if (lineIndex >= begin && lineIndex <= end) wanted.push(part.replace(/\r$/, ''))
            if (lineIndex >= end) break
          }
          if (lineIndex >= end) break
          if (wanted.join('\n').length > MAX_READ_BYTES) break
        }
        if (lineIndex < end && pending.length > 0) {
          lineIndex += 1
          if (lineIndex >= begin && lineIndex <= end) wanted.push(pending.replace(/\r$/, ''))
        }
      } finally {
        reader.releaseLock()
      }
      return { filetype: detectFiletype(path), content: wanted.join('\n') }
    })
  },
}
