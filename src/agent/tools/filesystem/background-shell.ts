import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { killProcessTree, shellSpec } from '@agent/tools/sandbox.ts'
import { toolOutputDir } from '@agent/tools/truncate-output.ts'
import { options } from '@config/options.ts'
import type { Experimental_SandboxSession } from 'ai'

export type BackgroundShellStatus = 'running' | 'completed' | 'stopped'

export interface BackgroundShellEntry {
  id: string
  command: string
  ownerSessionId: string | undefined
  startedAt: number
  status: BackgroundShellStatus
  exitCode: number | undefined
  logFile: string
  tail: string
  done: Promise<BackgroundShellStatus>
}

export interface StartBackgroundShellOptions {
  command: string
  cwd?: string
  ownerSessionId?: string
  sandbox?: Experimental_SandboxSession
  abortSignal?: AbortSignal
}

const TAIL_MAX_CHARS = 50_000
const registry = new Map<string, BackgroundShellEntry>()
const killers = new Map<string, () => void>()
const listeners = new Set<(entries: Array<BackgroundShellEntry>) => void>()
let idCounter = 0

const emit = (): void => {
  const snapshot = listBackgroundShells().map((entry) => ({ ...entry }))
  for (const listener of listeners) listener(snapshot)
}

export const listBackgroundShells = (): Array<BackgroundShellEntry> => [...registry.values()].sort((a, b) => a.startedAt - b.startedAt)

export const getBackgroundShell = (id: string): BackgroundShellEntry | undefined => registry.get(id)

export const runningBackgroundShells = (): Array<BackgroundShellEntry> => listBackgroundShells().filter((entry) => entry.status === 'running')

export const onBackgroundShells = (listener: (entries: Array<BackgroundShellEntry>) => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const newShellId = (): string => {
  idCounter += 1
  return `bg_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

const appendTail = (entry: BackgroundShellEntry, chunk: string): void => {
  entry.tail = entry.tail.length === 0 ? chunk : entry.tail + chunk
  if (entry.tail.length > TAIL_MAX_CHARS) entry.tail = entry.tail.slice(entry.tail.length - TAIL_MAX_CHARS)
}

const drainInto = (stream: ReadableStream<Uint8Array> | undefined, sink: (text: string) => void): Promise<void> => {
  if (!stream) return Promise.resolve()
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  return (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        sink(decoder.decode(value, { stream: true }))
      }
    } catch {}
  })()
}

export const startBackgroundShell = (opts: StartBackgroundShellOptions): BackgroundShellEntry => {
  const id = newShellId()
  const entry: BackgroundShellEntry = {
    id,
    command: opts.command,
    ownerSessionId: opts.ownerSessionId,
    startedAt: Date.now(),
    status: 'running',
    exitCode: undefined,
    logFile: resolve(toolOutputDir(), `bg_${id}.log`),
    tail: '',
    done: Promise.resolve('running'),
  }
  registry.set(id, entry)
  const finish = (exitCode: number): BackgroundShellStatus => {
    entry.exitCode = exitCode
    if (entry.status === 'running') {
      entry.status = exitCode === 0 ? 'completed' : 'stopped'
      emit()
    }
    return entry.status
  }
  const failStart = (): BackgroundShellStatus => {
    if (entry.status === 'running') {
      entry.status = 'stopped'
      emit()
    }
    return entry.status
  }
  const run = async (): Promise<BackgroundShellStatus> => {
    try {
      const logReady = mkdir(toolOutputDir(), { recursive: true }).catch(() => {})
      let kill: () => void
      let exited: PromiseLike<number>
      let stdout: ReadableStream<Uint8Array> | undefined
      let stderr: ReadableStream<Uint8Array> | undefined
      if (opts.sandbox) {
        const proc = await opts.sandbox.spawn({ command: opts.command, workingDirectory: opts.cwd, abortSignal: opts.abortSignal })
        stdout = proc.stdout as ReadableStream<Uint8Array>
        stderr = proc.stderr as ReadableStream<Uint8Array>
        exited = proc.wait().then((w) => w.exitCode)
        kill = () => {
          void proc.kill()
        }
      } else {
        const base = process.cwd()
        const cwd = opts.cwd ? resolve(base, opts.cwd) : base
        const proc = Bun.spawn({
          cmd: [...shellSpec(options.app.shell).cmd, opts.command],
          cwd,
          stdout: 'pipe',
          stderr: 'pipe',
          env: Bun.env,
          detached: process.platform !== 'win32',
        })
        stdout = proc.stdout as ReadableStream<Uint8Array>
        stderr = proc.stderr as ReadableStream<Uint8Array>
        exited = proc.exited
        kill = () => killProcessTree(proc)
      }
      killers.set(id, kill)
      if (entry.status !== 'running' || opts.abortSignal?.aborted) kill()
      const onAbort = () => kill()
      opts.abortSignal?.addEventListener('abort', onAbort, { once: true })
      const writeLog = (text: string): void => {
        void logReady.then(() => appendFile(entry.logFile, text, 'utf8')).catch(() => {})
      }
      const out = drainInto(stdout, (text) => {
        appendTail(entry, text)
        writeLog(text)
      })
      const err = drainInto(stderr, (text) => {
        appendTail(entry, text)
        writeLog(text)
      })
      const code = await exited
      opts.abortSignal?.removeEventListener('abort', onAbort)
      killers.delete(id)
      await Promise.allSettled([out, err])
      return finish(code)
    } catch {
      killers.delete(id)
      return failStart()
    }
  }
  entry.done = run()
  emit()
  return entry
}

export const stopBackgroundShell = async (id: string): Promise<BackgroundShellEntry | undefined> => {
  const entry = registry.get(id)
  if (!entry) return undefined
  if (entry.status === 'running') {
    entry.status = 'stopped'
    emit()
    killers.get(id)?.()
  }
  await entry.done.catch(() => {})
  return registry.get(id)
}

export const stopAllBackgroundShells = async (): Promise<void> => {
  const running = runningBackgroundShells()
  await Promise.all(running.map((entry) => stopBackgroundShell(entry.id)))
}
