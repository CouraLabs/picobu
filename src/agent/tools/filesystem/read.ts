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
  skip: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).optional(),
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
const sliceLines = (text: string, skip?: number, limit?: number): string => {
  const lines = text.split(/\r?\n/)
  const begin = (skip ?? 0) + 1
  const end = limit == null ? lines.length : begin + limit - 1
  return lines.slice(Math.max(begin - 1, 0), Math.min(end, lines.length)).join('\n')
}
export const readTool = {
  name: 'read',
  description: 'Read a file, optionally sliced by skip (0-based lines to skip) and limit (max lines). Omit both to read the whole file.',
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
      if (file.size > MAX_READ_BYTES && args.skip == null && args.limit == null) {
        throw new Error(`File is ${(file.size).toLocaleString()} bytes; pass skip and limit to read it in parts`)
      }
      if (file.size <= MAX_READ_BYTES) {
        const text = await file.text()
        return { filetype: detectFiletype(path), content: sliceLines(text, args.skip, args.limit) }
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
