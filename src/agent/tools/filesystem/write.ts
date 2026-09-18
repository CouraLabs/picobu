import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CheckpointStore } from '@agent/sessions/checkpoints.ts'
import { fileHasBom, joinBom, splitBom } from '@agent/tools/filesystem/bom.ts'
import { resolveInsideBase } from '@agent/tools/filesystem/paths.ts'
import { diffForFile } from '@agent/tools/filesystem/replacers.ts'
import { sandboxRoot } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { withLock } from '@shared/lock.ts'
import z from 'zod'
export const WriteToolArgsSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
})
const CONTENT_PREVIEW_MAX_LINES = 500
export interface WriteToolResult {
  message: string
  content: string
  diff?: string
}
export const WriteToolOutputSchema = z.object({
  message: z.string(),
  content: z.string(),
  diff: z.string().optional(),
})
export const createWriteTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined
  return {
    name: 'write',
    description: 'Write the "contents" to a file at "path", it can create files and parent directories as needed, existing files get "cotents" appended',
    parameters: WriteToolArgsSchema,
    output: WriteToolOutputSchema,
    skipPermission: true,
    handler: async (args: z.infer<typeof WriteToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<WriteToolResult> => {
      if (!args.path) throw new Error('write requires a non-empty path')
      const base = sandboxRoot(toolOptions?.experimental_sandbox)
      const resolvedPath = await resolveInsideBase(base, args.path)
      return withLock(resolvedPath, async () => {
        await mkdir(dirname(resolvedPath), { recursive: true })
        const file = Bun.file(resolvedPath)
        const existed = await file.exists()
        const beforeRaw = existed ? await file.text().catch(() => null) : null
        const beforeBom = existed ? await fileHasBom(resolvedPath) : false
        const next = splitBom(args.contents)
        const desiredBom = beforeBom || next.bom
        const finalContents = joinBom(next.text, desiredBom)
        await Bun.write(resolvedPath, finalContents)
        if (checkpoints) {
          await checkpoints.record({ tool: 'write', path: resolvedPath, before: beforeRaw, after: finalContents })
        }
        const contentLines = args.contents.split('\n')
        const lines = contentLines.length
        const content = lines > CONTENT_PREVIEW_MAX_LINES ? `${contentLines.slice(0, CONTENT_PREVIEW_MAX_LINES).join('\n')}\n…[truncated]` : args.contents
        const diff = beforeRaw === null ? diffForFile(resolvedPath, '', next.text) : diffForFile(resolvedPath, splitBom(beforeRaw).text, next.text)
        return {
          message: `Wrote ${args.path} (${lines} lines)`,
          content,
          diff,
        }
      })
    },
  }
}
