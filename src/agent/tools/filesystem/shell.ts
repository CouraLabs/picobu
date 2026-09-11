import { isAbsolute, relative, resolve } from 'node:path'
import { killProcessTree, shellSpec } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { options } from '@config/options.ts'
import z from 'zod'
export const ShellToolArgsSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().int().min(1).max(600).optional().describe('Timeout in seconds (1-600, default 120).'),
})
export const ShellToolOutputSchema = z.union([z.object({ progress: z.string() }), z.string()])
type ShellToolArgs = z.infer<typeof ShellToolArgsSchema>
type ShellToolChunk = z.infer<typeof ShellToolOutputSchema>
const DEFAULT_TIMEOUT_SECONDS = 120
const PROGRESS_INTERVAL_MS = 300
const PROGRESS_TAIL_LINES = 10
const PROGRESS_LINE_MAX = 160
const OUTPUT_MAX_CHARS = 100_000
const DRAIN_GRACE_MS = 500
interface Child {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: PromiseLike<number>
  kill: () => void
}
const truncateLine = (line: string): string => (line.length > PROGRESS_LINE_MAX ? `${line.slice(0, PROGRESS_LINE_MAX - 1)}…` : line)
const capOutput = (text: string): string => {
  if (text.length <= OUTPUT_MAX_CHARS) return text
  const half = OUTPUT_MAX_CHARS / 2
  return `${text.slice(0, half)}\n…[output truncated]…\n${text.slice(-half)}`
}
const drainStream = (stream: ReadableStream<Uint8Array>, sink: (text: string) => void, cancel: Promise<'cancel'>): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  return (async () => {
    try {
      while (true) {
        const result = await Promise.race([reader.read(), cancel])
        if (result === 'cancel') {
          void reader.cancel().catch(() => {})
          return
        }
        if (result.done) return
        sink(decoder.decode(result.value, { stream: true }))
      }
    } catch {}
  })()
}
const runStreaming = async function* (label: string, child: Child, toolOptions: ToolExecuteOptions | undefined, timeoutSeconds: number): AsyncGenerator<ShellToolChunk> {
  let aborted = false
  let timedOut = false
  const onAbort = () => {
    aborted = true
    child.kill()
  }
  toolOptions?.abortSignal?.addEventListener('abort', onAbort, { once: true })
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, timeoutSeconds * 1000)
  let stdout = ''
  let stderr = ''
  const tailLines: Array<string> = []
  let tailPending = ''
  let lastProgress = ''
  const pushText = (text: string) => {
    const parts = text.split('\n')
    tailPending += parts[0]
    for (const part of parts.slice(1)) {
      tailLines.push(truncateLine(tailPending))
      tailPending = part
    }
    if (tailLines.length > PROGRESS_TAIL_LINES) tailLines.splice(0, tailLines.length - PROGRESS_TAIL_LINES)
  }
  const sink = (which: 'out' | 'err') => (text: string) => {
    if (which === 'out' && stdout.length < OUTPUT_MAX_CHARS) stdout += text.slice(0, OUTPUT_MAX_CHARS - stdout.length)
    if (which === 'err' && stderr.length < OUTPUT_MAX_CHARS) stderr += text.slice(0, OUTPUT_MAX_CHARS - stderr.length)
    pushText(text)
  }
  const progressText = (): string => {
    const lines = tailPending.length > 0 ? [...tailLines, truncateLine(tailPending)] : [...tailLines]
    return lines.join('\n').replace(/^\n+/, '')
  }
  let resolveCancel: (value: 'cancel') => void = () => {}
  const cancel = new Promise<'cancel'>((resolve) => (resolveCancel = resolve))
  const drained = Promise.all([drainStream(child.stdout, sink('out'), cancel), drainStream(child.stderr, sink('err'), cancel)])
  try {
    let exitCode: number | undefined
    const startedAt = Date.now()
    let lastEmitAt = Date.now()
    while (true) {
      const result = await Promise.race([child.exited, Bun.sleep(PROGRESS_INTERVAL_MS).then(() => 'tick' as const)])
      if (result !== 'tick') {
        exitCode = result
        break
      }
      const now = Date.now()
      const progress = progressText()
      if (progress !== lastProgress) {
        lastProgress = progress
        lastEmitAt = now
        if (progress.length > 0) yield { progress }
        continue
      }
      if (now - startedAt >= 2_000 && now - lastEmitAt >= 3_000) {
        lastEmitAt = now
        const elapsed = Math.round((now - startedAt) / 1000)
        yield {
          progress: progress.length > 0 ? `${progress}\n(${elapsed}s, still running…)` : `(${elapsed}s, waiting for output…)`,
        }
      }
    }
    await Promise.race([drained, Bun.sleep(DRAIN_GRACE_MS)])
    resolveCancel('cancel')
    await drained.catch(() => {})
    if (timedOut) {
      throw new Error(
        `command \`${label}\` timed out after ${timeoutSeconds}s and was killed\n` +
          (stderr.trim() ? `stderr:\n${stderr.trim()}\n` : '') +
          (stdout.trim() ? `stdout:\n${capOutput(stdout).trim()}` : '(no output)'),
      )
    }
    if (aborted) {
      throw new Error(`command \`${label}\` was aborted\n${stdout.trim() ? `stdout:\n${capOutput(stdout).trim()}` : ''}`)
    }
    if (exitCode !== 0) {
      const stdoutTrim = capOutput(stdout).trim()
      const stderrTrim = capOutput(stderr).trim()
      throw new Error(`command \`${label}\` exited ${exitCode}\n${stderrTrim ? `stderr:\n${stderrTrim}\n` : ''}${stdoutTrim ? `stdout:\n${stdoutTrim}` : ''}`)
    }
    yield capOutput(stdout).trimEnd() || '(no output)'
  } finally {
    clearTimeout(timeoutTimer)
    toolOptions?.abortSignal?.removeEventListener('abort', onAbort)
    resolveCancel('cancel')
  }
}
export function createShellTool() {
  return {
    name: 'shell',
    description: 'Run a shell command; streams output live, kills on timeout. Prefer read/write/edit/glob/grep when they fit.',
    parameters: ShellToolArgsSchema,
    output: ShellToolOutputSchema,
    isTerminal: true,
    overridesBuiltInTool: true,
    skipPermission: true,
    defer: 'auto',
    handler: async function* (args: ShellToolArgs, toolOptions?: ToolExecuteOptions): AsyncGenerator<ShellToolChunk> {
      const sandbox = toolOptions?.experimental_sandbox
      const timeoutSeconds = args.timeout ?? DEFAULT_TIMEOUT_SECONDS
      let child: Child
      if (sandbox) {
        const proc = await sandbox.spawn({
          command: args.command,
          workingDirectory: args.cwd,
          abortSignal: toolOptions?.abortSignal,
        })
        child = {
          stdout: proc.stdout as ReadableStream<Uint8Array>,
          stderr: proc.stderr as ReadableStream<Uint8Array>,
          exited: proc.wait().then((w) => w.exitCode),
          kill: () => void proc.kill(),
        }
      } else {
        const base = process.cwd()
        const cwd = args.cwd ? resolve(base, args.cwd) : base
        const rel = relative(base, cwd)
        if (rel !== '' && (rel === '..' || rel.startsWith('../') || isAbsolute(rel))) {
          throw new Error(`Working directory escapes allowed root: ${args.cwd}`)
        }
        const proc = Bun.spawn({
          cmd: [...shellSpec(options.app.shell).cmd, args.command],
          cwd,
          stdout: 'pipe',
          stderr: 'pipe',
          detached: process.platform !== 'win32',
        })
        child = {
          stdout: proc.stdout as ReadableStream<Uint8Array>,
          stderr: proc.stderr as ReadableStream<Uint8Array>,
          exited: proc.exited,
          kill: () => killProcessTree(proc),
        }
      }
      yield* runStreaming(args.command, child, toolOptions, timeoutSeconds)
    },
  }
}
