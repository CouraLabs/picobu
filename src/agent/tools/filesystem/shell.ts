import { isAbsolute, relative, resolve } from 'node:path'
import { startBackgroundShell } from '@agent/tools/filesystem/background-shell.ts'
import { killProcessTree, sandboxRoot, shellSpec } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { MAX_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_LINES, tailText, writeFullToolOutput } from '@agent/tools/truncate-output.ts'
import { options } from '@config/options.ts'
import z from 'zod'
export const ShellToolArgsSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout: z.number().int().min(1).max(600).optional().describe('Timeout in seconds (1-600, default 120).'),
  run_in_background: z.boolean().optional().describe('Start the command in the background and return a taskId immediately; collect output later with task_output.'),
})
export const ShellToolOutputSchema = z.union([z.object({ progress: z.string() }), z.string(), z.object({ taskId: z.string(), outputFile: z.string(), note: z.string() })])
type ShellToolArgs = z.infer<typeof ShellToolArgsSchema>
type ShellToolChunk = z.infer<typeof ShellToolOutputSchema>
const DEFAULT_TIMEOUT_SECONDS = 120
const PROGRESS_INTERVAL_MS = 300
const PROGRESS_TAIL_LINES = 10
const PROGRESS_LINE_MAX = 160
const DRAIN_GRACE_MS = 500
interface Child {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: PromiseLike<number>
  kill: () => void
}
const truncateLine = (line: string): string => (line.length > PROGRESS_LINE_MAX ? `${line.slice(0, PROGRESS_LINE_MAX - 1)}…` : line)
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
const spillCombined = async (label: string, exit: number | null, stdout: string, stderr: string): Promise<string | undefined> => {
  const combined = `$ ${label}\n(exit ${exit === null ? 'killed' : exit})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
  if (Buffer.byteLength(combined, 'utf-8') <= MAX_TOOL_OUTPUT_BYTES) return undefined
  return writeFullToolOutput(combined)
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
  const outParts: Array<string> = []
  const errParts: Array<string> = []
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
    if (which === 'out') outParts.push(text)
    else errParts.push(text)
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
    const stdout = outParts.join('')
    const stderr = errParts.join('')
    if (timedOut) {
      const tail = tailText(stdout, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES)
      const spilled = tail.cut || Buffer.byteLength(stdout, 'utf-8') > MAX_TOOL_OUTPUT_BYTES ? await spillCombined(label, null, stdout, stderr) : undefined
      throw new Error(
        `command \`${label}\` timed out after ${timeoutSeconds}s and was killed\n` +
          (stderr.trim() ? `stderr:\n${tailText(stderr, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES).text.trim()}\n` : '') +
          (stdout.trim() ? `stdout:\n${tail.cut ? `...output truncated...${spilled ? `\n\nFull output saved to: ${spilled}` : ''}\n\n${tail.text}` : tail.text}`.trim() : '(no output)') +
          `\n\n<shell_metadata>\nexit: timeout after ${timeoutSeconds}s\n</shell_metadata>`,
      )
    }
    if (aborted) {
      const tail = tailText(stdout, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES)
      throw new Error(`command \`${label}\` was aborted\n${stdout.trim() ? `stdout:\n${tail.text.trim()}` : ''}\n\n<shell_metadata>\nexit: aborted\n</shell_metadata>`)
    }
    if (exitCode !== 0) {
      const outTail = tailText(stdout, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES)
      const errTail = tailText(stderr, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES)
      const spilled = outTail.cut || errTail.cut ? await spillCombined(label, exitCode ?? null, stdout, stderr) : undefined
      const spillNote = spilled ? `...output truncated...\n\nFull output saved to: ${spilled}\n\n` : ''
      throw new Error(
        `command \`${label}\` exited ${exitCode}\n${errTail.text.trim() ? `stderr:\n${errTail.text.trim()}\n` : ''}${stdout.trim() ? `stdout:\n${spillNote}${outTail.text.trim()}` : ''}\n\n<shell_metadata>\nexit: ${exitCode}\n</shell_metadata>`,
      )
    }
    const tail = tailText(stdout, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES)
    if (!tail.cut) {
      yield stdout.trimEnd() || '(no output)'
      return
    }
    const spilled = await spillCombined(label, exitCode ?? 0, stdout, stderr)
    yield `${spilled ? `...output truncated...\n\nFull output saved to: ${spilled}\n\n` : '...output truncated...\n\n'}${tail.text.trimEnd() || '(no output)'}`
  } finally {
    clearTimeout(timeoutTimer)
    toolOptions?.abortSignal?.removeEventListener('abort', onAbort)
    resolveCancel('cancel')
  }
}
export function createShellTool(ctx: { sessionId?: string; allowBackground?: boolean } = {}) {
  const allowBackground = ctx.allowBackground !== false
  const parameters = allowBackground ? ShellToolArgsSchema : ShellToolArgsSchema.extend({}).omit({ run_in_background: true })
  return {
    name: 'shell',
    description: allowBackground
      ? 'Run a shell command; streams output live, kills on timeout. Large output is tailed near 50KB/2000 lines with the full log spilled to a file. Prefer read/write/edit/glob/grep when they fit. Run expensive commands once and filter the output file instead of re-running to re-filter. Use run_in_background for dev servers, watchers and long builds, then collect with task_output.'
      : 'Run a shell command; streams output live, kills on timeout. Large output is tailed near 50KB/2000 lines with the full log spilled to a file. Prefer read/write/edit/glob/grep when they fit. Run expensive commands once and filter the output file instead of re-running to re-filter.',
    parameters,
    output: ShellToolOutputSchema,
    isTerminal: true,
    overridesBuiltInTool: true,
    skipPermission: true,
    defer: 'auto',
    handler: async function* (args: ShellToolArgs, toolOptions?: ToolExecuteOptions): AsyncGenerator<ShellToolChunk> {
      if (args.run_in_background) {
        const sandboxRootPath = sandboxRoot(toolOptions?.experimental_sandbox) ?? process.cwd()
        if (args.cwd) {
          const cwdPath = resolve(sandboxRootPath, args.cwd)
          const rel = relative(sandboxRootPath, cwdPath)
          if (rel !== '' && (rel === '..' || rel.startsWith('../') || isAbsolute(rel))) {
            throw new Error(`Working directory escapes allowed root: ${args.cwd}`)
          }
        }
        const entry = startBackgroundShell({
          command: args.command,
          cwd: args.cwd,
          ...(ctx.sessionId ? { ownerSessionId: ctx.sessionId } : {}),
          ...(toolOptions?.experimental_sandbox ? { sandbox: toolOptions.experimental_sandbox } : {}),
          ...(toolOptions?.abortSignal ? { abortSignal: toolOptions.abortSignal } : {}),
        })
        yield {
          taskId: entry.id,
          outputFile: entry.logFile,
          note: `Command running in background as ${entry.id}. Full output streams to ${entry.logFile}. Collect results with task_output (block: true) when you need them; do not poll in a loop.`,
        }
        return
      }
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
