import { resolve } from 'node:path'
import { agentDirsUnder, insideAgentDir } from '@agent/tools/filesystem/agent-dirs.ts'
import { resolveRgPath } from '@agent/tools/filesystem/rg.ts'
import { killProcessTree } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { detectFiletype } from '@shared/filetype.ts'
import z from 'zod'

const GrepToolOutputSchema = z.object({
  filetype: z.string(),
  content: z.string(),
})
export const GrepToolArgsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1),
  include: z.string().optional().describe('File glob to include in the search (e.g. "*.ts", "*.{ts,tsx}").'),
  limit: z.number().int().min(1).max(1000).optional(),
})
async function runArgv(argv: Array<string>, cwd: string, toolOptions?: ToolExecuteOptions) {
  const abortSignal = toolOptions?.abortSignal
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (abortSignal?.aborted) killProcessTree(proc)
  const onAbort = () => killProcessTree(proc)
  abortSignal?.addEventListener('abort', onAbort, { once: true })
  try {
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    return { exitCode, stdout, stderr }
  } finally {
    abortSignal?.removeEventListener('abort', onAbort)
  }
}
export const grepTool = {
  name: 'grep',
  description:
    'Search files with ripgrep regex; requires a path to search; returns matching lines as path:line: content (max 100 by default, capped at 1000). Use include to filter by file glob (e.g. "*.ts"). Respects .gitignore except inside .agents dirs.',
  parameters: GrepToolArgsSchema,
  output: GrepToolOutputSchema,
  isTerminal: false,
  overridesBuiltInTool: true,
  skipPermission: true,
  defer: 'auto',
  handler: async (args: z.infer<typeof GrepToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof GrepToolOutputSchema>> => {
    const rgPath = await resolveRgPath()
    const limit = args.limit ?? 100
    const root = process.cwd()
    const searchPath = resolve(root, args.path)
    const base = resolve(searchPath)
    const bypassFilters = insideAgentDir(base)
    const flags = bypassFilters ? ['--hidden', '--no-ignore-vcs'] : []
    const includeFlags = args.include ? ['--glob', args.include] : []
    const proc = await runArgv([rgPath, '-n', '--with-filename', '--no-heading', '--color', 'never', ...flags, ...includeFlags, '-e', args.pattern, '--', searchPath], root, toolOptions)
    if (proc.exitCode !== 0 && proc.exitCode !== 1) throw new Error(`rg failed (exit ${proc.exitCode}): ${proc.stderr.trim()}`)
    const lines = new Set(proc.stdout.trim().split('\n').filter(Boolean))
    if (!bypassFilters) {
      for (const dir of await agentDirsUnder(base)) {
        const pass = await runArgv(
          [rgPath, '-n', '--with-filename', '--no-heading', '--color', 'never', '--hidden', '--no-ignore-vcs', ...includeFlags, '-e', args.pattern, '--', dir],
          root,
          toolOptions,
        )
        if (pass.exitCode !== 0 && pass.exitCode !== 1) throw new Error(`rg failed (exit ${pass.exitCode}): ${pass.stderr.trim()}`)
        for (const line of pass.stdout.trim().split('\n').filter(Boolean)) lines.add(line)
      }
    }
    if (lines.size === 0) return { filetype: 'text', content: `No matches for /${args.pattern}/ in ${searchPath}` }
    const sorted = [...lines].sort()
    const truncated = sorted.length > limit
    const prefix = `${root}/`
    const shown = sorted
      .slice(0, limit)
      .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
      .map((line) => line.replace(/^(.+):(\d+):(\S)/, '$1:$2: $3'))
    const content = truncated ? [...shown, `(Results truncated to ${limit} of ${sorted.length}. Narrow path/pattern or raise limit.)`].join('\n') : shown.join('\n')
    return { filetype: detectFiletype(searchPath), content }
  },
}
