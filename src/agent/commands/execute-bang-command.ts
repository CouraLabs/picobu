import { resolve } from 'node:path'
import { killProcessTree, shellSpec } from '@agent/tools/sandbox.ts'
import { truncateTextWithSpill } from '@agent/tools/truncate-output.ts'
import { options } from '@config/options.ts'

export interface BangCommandOptions {
  timeoutSeconds?: number
  signal?: AbortSignal
}

export interface BangCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
  outputPath?: string
  durationMs: number
}

export const executeBangCommand = async (command: string, cwd: string, opts?: BangCommandOptions): Promise<BangCommandResult> => {
  if (command.trim().length === 0) throw new Error('Usage: !<command>')
  const timeoutSeconds = opts?.timeoutSeconds ?? 60
  const startedAt = Date.now()
  const workingDir = resolve(cwd)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  const onExternalAbort = () => controller.abort()
  opts?.signal?.addEventListener('abort', onExternalAbort, { once: true })
  let timedOut = controller.signal.aborted
  try {
    let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
    try {
      proc = Bun.spawn({
        cmd: [...shellSpec(options.app.shell).cmd, '-c', command],
        cwd: workingDir,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      return {
        exitCode: 127,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
        durationMs: Date.now() - startedAt,
      }
    }
    const onAbort = () => {
      timedOut = true
      killProcessTree(proc)
    }
    controller.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      const durationMs = Date.now() - startedAt
      const stderrWithNote = timedOut ? `${stderr}${stderr.length > 0 && !stderr.endsWith('\n') ? '\n' : ''}(timed out after ${timeoutSeconds}s)` : stderr
      const spilled = await truncateTextWithSpill(`${stdout}${stderrWithNote}`, { direction: 'tail' })
      const truncatedStdout = spilled.truncated ? spilled.text : stdout
      const truncatedStderr = spilled.truncated ? '' : stderrWithNote
      return {
        exitCode: timedOut ? 124 : exitCode,
        stdout: truncatedStdout,
        stderr: truncatedStderr,
        truncated: spilled.truncated,
        outputPath: spilled.outputPath,
        durationMs,
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
      opts?.signal?.removeEventListener('abort', onExternalAbort)
    }
  } finally {
    clearTimeout(timer)
  }
}
