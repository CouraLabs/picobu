import { logWarn } from '@shared/logger.ts'

const MAX_LINE_CHARS = 2000
const MAX_PENDING_CHARS = 16_000

interface StderrWrite {
  (chunk: Uint8Array | string, encoding?: BufferEncoding, callback?: (error?: Error | null) => void): boolean
  (chunk: Uint8Array | string, callback?: (error?: Error | null) => void): boolean
}

const truncateLogLine = (line: string): string => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line)

const decoder = new TextDecoder()

const toText = (chunk: Uint8Array | string): string => (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }))

export const divertStderr = (debug: boolean): (() => void) => {
  const original = process.stderr.write.bind(process.stderr) as StderrWrite
  let pending = ''
  const diverted = ((chunk: Uint8Array | string, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const done = typeof encoding === 'function' ? encoding : callback
    pending += toText(chunk)
    if (pending.length > MAX_PENDING_CHARS) {
      logWarn(truncateLogLine(pending.slice(0, MAX_PENDING_CHARS)), { scope: 'stderr' })
      pending = ''
    }
    let index = pending.indexOf('\n')
    while (index >= 0) {
      const line = pending.slice(0, index)
      pending = pending.slice(index + 1)
      if (line.trim().length > 0) {
        logWarn(truncateLogLine(line), { scope: 'stderr' })
        if (debug) console.warn(line)
      }
      index = pending.indexOf('\n')
    }
    done?.(null)
    return true
  }) as StderrWrite
  process.stderr.write = diverted as typeof process.stderr.write
  return () => {
    decoder.decode()
    process.stderr.write = original as typeof process.stderr.write
  }
}
