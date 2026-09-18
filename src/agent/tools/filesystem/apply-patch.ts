import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CheckpointStore } from '@agent/sessions/checkpoints.ts'
import { joinBom, splitBom } from '@agent/tools/filesystem/bom.ts'
import { resolveInsideBase } from '@agent/tools/filesystem/paths.ts'
import { diffForFile } from '@agent/tools/filesystem/replacers.ts'
import { sandboxRoot } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { withLock } from '@shared/lock.ts'
import { parsePatch } from 'diff'
import z from 'zod'

export const ApplyPatchToolArgsSchema = z.object({
  patch: z.string().min(1).describe('Unified diff covering one or more files (--- a/path / +++ b/path with @@ hunks). New files use --- /dev/null, deletions use +++ /dev/null.'),
})
export interface ApplyPatchFileChange {
  path: string
  type: 'add' | 'update' | 'delete'
}
export interface ApplyPatchToolResult {
  message: string
  files: Array<string>
  diff: string
}
export const ApplyPatchToolOutputSchema = z.object({
  message: z.string(),
  files: z.array(z.string()),
  diff: z.string(),
})

const stripPrefix = (name: string): string => {
  const trimmed = name.trim().replace(/^"|"$/g, '')
  if (trimmed === '/dev/null') return trimmed
  return trimmed.replace(/^[ab]\//, '')
}

interface StructuredHunk {
  oldStart: number
  lines: Array<string>
}

const applyHunks = (oldText: string, hunks: Array<StructuredHunk>, display: string): string => {
  const oldLines = oldText.split('\n')
  const out: Array<string> = []
  let cursor = 0
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1)
    if (start < cursor) throw new Error(`apply_patch verification failed: overlapping hunks in ${display}`)
    while (cursor < start) {
      out.push(oldLines[cursor] as string)
      cursor++
    }
    for (const raw of hunk.lines) {
      if (raw.startsWith('\\')) continue
      const kind = raw[0]
      const body = raw.slice(1)
      if (kind === ' ') {
        if (oldLines[cursor] !== body) throw new Error(`apply_patch verification failed: context mismatch in ${display}`)
        out.push(body)
        cursor++
      } else if (kind === '-') {
        if (oldLines[cursor] !== body) throw new Error(`apply_patch verification failed: removal mismatch in ${display}`)
        cursor++
      } else if (kind === '+') {
        out.push(body)
      } else if (raw.length === 0) {
        if (oldLines[cursor] !== '') throw new Error(`apply_patch verification failed: context mismatch in ${display}`)
        out.push('')
        cursor++
      } else {
        throw new Error(`apply_patch verification failed: bad hunk line in ${display}`)
      }
    }
  }
  while (cursor < oldLines.length) {
    out.push(oldLines[cursor] as string)
    cursor++
  }
  return out.join('\n')
}

export const createApplyPatchTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined
  return {
    name: 'apply_patch',
    description:
      'Apply a unified diff across one or more files atomically (verified before writing). Use for multi-file changes; prefer edit for single small replacements. New files: --- /dev/null. Deletions: +++ /dev/null. Paths are relative to the working directory (a/ and b/ prefixes stripped).',
    parameters: ApplyPatchToolArgsSchema,
    output: ApplyPatchToolOutputSchema,
    handler: async (args: z.infer<typeof ApplyPatchToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<ApplyPatchToolResult> => {
      if (!args.patch.trim()) throw new Error('patch is required')
      let parsed: ReturnType<typeof parsePatch>
      try {
        parsed = parsePatch(args.patch)
      } catch (error) {
        throw new Error(`apply_patch verification failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (parsed.length === 0) throw new Error('apply_patch verification failed: no file patches found')
      const base = sandboxRoot(toolOptions?.experimental_sandbox)
      const planned: Array<{ resolved: string; display: string; oldContent: string; newContent: string; type: 'add' | 'update' | 'delete'; bom: boolean }> = []
      for (const file of parsed) {
        const oldName = stripPrefix(file.oldFileName ?? '')
        const newName = stripPrefix(file.newFileName ?? '')
        const isAdd = oldName === '/dev/null'
        const isDelete = newName === '/dev/null'
        const display = isDelete ? oldName : newName
        if (!display || display === '/dev/null') throw new Error('apply_patch verification failed: patch is missing a file path')
        const resolved = await resolveInsideBase(base, display)
        const existing = isAdd
          ? null
          : await Bun.file(resolved)
              .text()
              .catch(() => null)
        if (!isAdd && existing === null) throw new Error(`apply_patch verification failed: file to update not found: ${display}`)
        const source = isAdd ? { bom: false, text: '' } : splitBom(existing as string)
        const applied = applyHunks(source.text, file.hunks as Array<StructuredHunk>, display)
        const next = splitBom(applied)
        planned.push({
          resolved,
          display,
          oldContent: isAdd ? '' : (existing as string),
          newContent: joinBom(next.text, source.bom || next.bom),
          type: isAdd ? 'add' : isDelete ? 'delete' : 'update',
          bom: source.bom || next.bom,
        })
      }
      const diffs: Array<string> = []
      for (const change of planned) {
        const before = change.type === 'add' ? '' : splitBom(change.oldContent).text
        const after = change.type === 'delete' ? '' : splitBom(change.newContent).text
        diffs.push(diffForFile(change.resolved, before, after))
      }
      const ordered = [...planned].sort((a, b) => (a.resolved < b.resolved ? -1 : 1))
      for (const change of ordered) {
        await withLock(change.resolved, async () => {
          if (change.type === 'delete') {
            await rm(change.resolved, { force: true })
          } else {
            await mkdir(dirname(change.resolved), { recursive: true })
            await Bun.write(change.resolved, change.newContent)
          }
          if (checkpoints) {
            await checkpoints.record({
              tool: 'write',
              path: change.resolved,
              before: change.type === 'add' ? null : change.oldContent,
              after: change.type === 'delete' ? null : change.newContent,
            })
          }
        })
      }
      const summary = ordered.map((change) => `${change.type === 'add' ? 'A' : change.type === 'delete' ? 'D' : 'M'} ${change.display}`)
      return {
        message: `Applied patch to ${ordered.length} file(s):\n${summary.join('\n')}`,
        files: ordered.map((change) => change.display),
        diff: diffs.join('\n'),
      }
    },
  }
}
