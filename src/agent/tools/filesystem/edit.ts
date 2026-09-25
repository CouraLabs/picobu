import { CheckpointStore } from '@agent/sessions/checkpoints.ts'
import { joinBom, readFileWithBom, splitBom } from '@agent/tools/filesystem/bom.ts'
import { resolveInsideBase } from '@agent/tools/filesystem/paths.ts'
import { convertToLineEnding, detectLineEnding, diffForFile, normalizeLineEndings, replaceText } from '@agent/tools/filesystem/replacers.ts'
import { withLock } from '@shared/lock.ts'
import z from 'zod'
export const EditToolArgsSchema = z.object({
  path: z.string().min(1),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional().describe('Replace all occurrences of oldString (default false).'),
})
export interface EditToolResult {
  message: string
  diff: string
}
export const EditToolOutputSchema = z.object({
  message: z.string(),
  diff: z.string(),
})
export const createEditTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined
  return {
    name: 'edit',
    description: 'Replace oldString with newString using exact or whitespace-tolerant matching; fails on missing matches, refuses ambiguous single replaces unless replaceAll is true, returns diff.',
    parameters: EditToolArgsSchema,
    output: EditToolOutputSchema,
    handler: async (args: z.infer<typeof EditToolArgsSchema>): Promise<EditToolResult> => {
      if (!args.path) throw new Error('edit requires a non-empty path')
      const path = await resolveInsideBase(undefined, args.path)
      return withLock(path, async () => {
        const file = Bun.file(path)
        const exists = await file.exists()
        if (args.oldString === '') {
          if (exists) throw new Error('oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.')
          await Bun.write(path, args.newString)
          if (checkpoints) {
            await checkpoints.record({ tool: 'edit', path, before: null, after: args.newString })
          }
          return {
            message: `Created ${path} via edit (empty oldString on missing file)`,
            diff: diffForFile(path, '', splitBom(args.newString).text),
          }
        }
        if (!exists) throw new Error(`File not found: ${path}`)
        const read = await readFileWithBom(path)
        const source = { bom: read.bom, text: read.text }
        const ending = detectLineEnding(source.text)
        const content = normalizeLineEndings(source.text)
        const oldNormalized = normalizeLineEndings(args.oldString)
        const newNormalized = normalizeLineEndings(args.newString)
        const updatedNormalized = replaceText(content, oldNormalized, newNormalized, args.replaceAll ?? false)
        const updated = convertToLineEnding(updatedNormalized, ending)
        const desiredBom = source.bom || splitBom(args.newString).bom
        await Bun.write(path, joinBom(updated, desiredBom))
        if (checkpoints) {
          await checkpoints.record({ tool: 'edit', path, before: joinBom(source.text, source.bom), after: joinBom(updated, desiredBom) })
        }
        const occurrences = (args.replaceAll ?? false) ? 'all occurrences' : 'single occurrence'
        return {
          message: `Replaced ${occurrences} in ${path}`,
          diff: diffForFile(path, source.text, updated),
        }
      })
    },
  }
}
