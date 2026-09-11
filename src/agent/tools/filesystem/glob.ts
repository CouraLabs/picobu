import { relative, resolve } from 'node:path'
import { agentDirsUnder } from '@agent/tools/filesystem/agent-dirs.ts'
import { killProcessTree, type LocalSandboxSession, sandboxRoot } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { rgPath } from '@vscode/ripgrep'
import z from 'zod'
export const GlobToolArgsSchema = z.object({
  pattern: z.string(),
  cwd: z.string().optional(),
})
async function runArgv(argv: Array<string>, cwd: string, toolOptions?: ToolExecuteOptions) {
  const sandbox = toolOptions?.experimental_sandbox as LocalSandboxSession | undefined
  if (sandbox && typeof sandbox.exec === 'function') return sandbox.exec(argv, { cwd })
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    detached: process.platform !== 'win32',
  })
  const abortSignal = toolOptions?.abortSignal
  if (abortSignal?.aborted) {
    killProcessTree(proc)
  }
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
export const globTool = {
  name: 'glob',
  description: 'Find files by glob pattern; respects .gitignore.',
  parameters: GlobToolArgsSchema,
  output: z.string(),
  handler: async (args: z.infer<typeof GlobToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<string> => {
    const cwd = resolve(sandboxRoot(toolOptions?.experimental_sandbox) ?? process.cwd(), args.cwd ?? '.')
    const listing = await runArgv([rgPath, '--files', '--color', 'never'], cwd, toolOptions)
    if (listing.exitCode !== 0 && listing.exitCode !== 1) throw new Error(`rg failed (exit ${listing.exitCode}): ${listing.stderr.trim()}`)
    const allowed = new Set(listing.stdout.trim().split('\n').filter(Boolean))
    for (const dir of await agentDirsUnder(cwd)) {
      const rel = relative(cwd, dir)
      const pass = await runArgv([rgPath, '--files', '--color', 'never', '--hidden', '--no-ignore-vcs', rel], cwd, toolOptions)
      if (pass.exitCode !== 0 && pass.exitCode !== 1) throw new Error(`rg failed (exit ${pass.exitCode}): ${pass.stderr.trim()}`)
      for (const file of pass.stdout.trim().split('\n').filter(Boolean)) allowed.add(file)
    }
    const glob = new Bun.Glob(args.pattern)
    const matches: Array<string> = []
    for await (const match of glob.scan({ cwd, dot: true })) {
      if (allowed.has(match)) matches.push(match)
    }
    matches.sort()
    return matches.join('\n')
  },
}
