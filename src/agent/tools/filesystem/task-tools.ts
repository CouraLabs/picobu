import { getBackgroundShell, stopBackgroundShell } from '@agent/tools/filesystem/background-shell.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { MAX_TOOL_OUTPUT_BYTES, MAX_TOOL_OUTPUT_LINES, tailText } from '@agent/tools/truncate-output.ts'
import z from 'zod'

const TaskOutputArgsSchema = z.object({
  taskId: z.string().min(1),
  block: z.boolean().optional().describe('Wait for completion when true (default true); return the current snapshot when false.'),
  timeout: z.number().int().min(1).max(600).optional().describe('Max seconds to wait when blocking (1-600, default 60).'),
})
const TaskOutputOutputSchema = z.object({
  taskId: z.string(),
  status: z.enum(['running', 'completed', 'stopped', 'unknown']),
  exitCode: z.number().optional(),
  output: z.string(),
})
const TaskStopArgsSchema = z.object({ taskId: z.string().min(1) })
const TaskStopOutputSchema = z.object({
  taskId: z.string(),
  status: z.enum(['running', 'completed', 'stopped', 'unknown']),
  message: z.string(),
})

const DEFAULT_BLOCK_TIMEOUT_SECONDS = 60

interface ShellEntrySnapshot {
  id: string
  status: string
  exitCode: number | undefined
  tail: string
  logFile: string
}

const renderEntry = (entry: ShellEntrySnapshot): { status: 'running' | 'completed' | 'stopped'; output: string } => {
  const tail = tailText(entry.tail, MAX_TOOL_OUTPUT_LINES, MAX_TOOL_OUTPUT_BYTES)
  const header = `[${entry.id}] ${entry.status}${entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : ''}`
  const logNote = tail.cut ? `…earlier output truncated; full log at ${entry.logFile}` : `full log at ${entry.logFile}`
  return { status: entry.status as 'running' | 'completed' | 'stopped', output: `${header}\n${logNote}\n\n${tail.text.trimEnd() || '(no output yet)'}` }
}

const waitWithTimeout = async (done: Promise<unknown>, ms: number): Promise<boolean> => {
  const finished = await Promise.race([done.then(() => true), Bun.sleep(ms).then(() => false)])
  return finished === true
}

export const createTaskOutputTool = () => ({
  name: 'task_output',
  kind: 'filesystem' as const,
  description:
    'Collect the output of a background shell started with shell run_in_background. Blocks until the task finishes or the timeout elapses (default 60s); use block: false for an instant snapshot. Returns status, exit code and the output tail.',
  parameters: TaskOutputArgsSchema,
  output: TaskOutputOutputSchema,
  handler: async (args: z.infer<typeof TaskOutputArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof TaskOutputOutputSchema>> => {
    const entry = getBackgroundShell(args.taskId)
    if (!entry) return { taskId: args.taskId, status: 'unknown' as const, output: `Unknown background task: ${args.taskId}. It may have been started in another process or the id is wrong.` }
    const signal = toolOptions?.abortSignal
    if (args.block !== false && entry.status === 'running' && !signal?.aborted) {
      const timeoutSeconds = args.timeout ?? DEFAULT_BLOCK_TIMEOUT_SECONDS
      await Promise.race([waitWithTimeout(entry.done, timeoutSeconds * 1000), ...(signal ? [new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))] : [])])
    }
    const rendered = renderEntry(entry)
    return { taskId: entry.id, status: rendered.status, ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}), output: rendered.output }
  },
})

export const createTaskStopTool = () => ({
  name: 'task_stop',
  kind: 'filesystem' as const,
  description: 'Kill a background shell task started with shell run_in_background.',
  parameters: TaskStopArgsSchema,
  output: TaskStopOutputSchema,
  handler: async (args: z.infer<typeof TaskStopArgsSchema>, _toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof TaskStopOutputSchema>> => {
    const entry = await stopBackgroundShell(args.taskId)
    if (!entry) return { taskId: args.taskId, status: 'unknown' as const, message: `Unknown background task: ${args.taskId}.` }
    return {
      taskId: entry.id,
      status: entry.status,
      message: entry.status === 'running' ? 'Stop requested; the process is terminating.' : `Task is ${entry.status}${entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : ''}.`,
    }
  },
})
