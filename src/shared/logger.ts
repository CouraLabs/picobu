import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from 'pino'
import pino from 'pino'

export interface LoggerInit {
  runId?: string
  systemDir?: string
}

export type LogContext = Record<string, unknown>

interface ErrorShape {
  name: string
  message: string
  stack?: string
  cause?: ErrorShape
  details?: Record<string, unknown>
}

const MAX_LOG_FILES = 20
const LOG_PREFIX = 'log-'
const LOG_SUFFIX = '.log'
const BENIGN_STREAM_CLOSE_MESSAGE = 'Controller is already closed'

let activeLogger: Logger | undefined
let activeDest: unknown
let activePath: string | undefined
let activeRunId: string | undefined
let activeSystemDir: string | undefined
let handlersInstalled = false
let uncaughtHandler: ((error: Error) => void) | undefined
let rejectionHandler: ((reason: unknown) => void) | undefined
let warningHandler: ((warning: Error) => void) | undefined

export const sanitizeRunId = (value: string): string => {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 64) : `pid-${process.pid}`
}

export const formatDateForFilename = (date: Date): string => {
  return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '')
}

export const buildLogFileName = (runId: string, date: Date): string => {
  return `${LOG_PREFIX}${sanitizeRunId(runId)}-${formatDateForFilename(date)}${LOG_SUFFIX}`
}

const resolveSystemDir = (override?: string): string => {
  if (override && override.trim().length > 0) return override
  return join(homedir(), '.picobu')
}

const isClosable = (value: unknown): value is { end: () => void } => {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { end?: unknown }).end === 'function'
}

const pruneOldLogs = (dir: string, keepPath?: string): void => {
  let names: Array<string> = []
  try {
    names = readdirSync(dir).filter((name) => name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX))
  } catch {
    return
  }
  const withTime = names
    .map((name) => {
      let mtime = 0
      try {
        mtime = statSync(join(dir, name)).mtimeMs
      } catch {
        mtime = 0
      }
      return { name, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
  const rest = withTime.filter((entry) => !(keepPath && join(dir, entry.name) === keepPath))
  for (let index = MAX_LOG_FILES - 1; index < rest.length; index++) {
    const entry = rest[index]
    if (!entry) continue
    try {
      rmSync(join(dir, entry.name), { force: true })
    } catch {}
  }
}

const MAX_ERROR_DETAIL_CHARS = 2000

const truncDetail = (value: unknown): unknown => {
  if (typeof value === 'string') return value.length > MAX_ERROR_DETAIL_CHARS ? `${value.slice(0, MAX_ERROR_DETAIL_CHARS)}…` : value
  try {
    const text = JSON.stringify(value)
    if (text && text.length > MAX_ERROR_DETAIL_CHARS) return `${text.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
  } catch {}
  return value
}

const errorCallDetails = (error: Error): Record<string, unknown> | undefined => {
  const record = error as Error & { statusCode?: unknown; url?: unknown; responseBody?: unknown; data?: unknown; lastError?: unknown }
  const source = (record.statusCode !== undefined || record.url !== undefined || record.responseBody !== undefined ? record : (record.lastError as typeof record | undefined)) ?? record
  const details: Record<string, unknown> = {}
  if (typeof source.statusCode === 'number') details.statusCode = source.statusCode
  if (typeof source.url === 'string' && source.url.length > 0) details.url = source.url
  if (source.responseBody !== undefined) details.responseBody = truncDetail(source.responseBody)
  else if (source.data !== undefined) details.data = truncDetail(source.data)
  return Object.keys(details).length > 0 ? details : undefined
}

const serializeError = (error: unknown, depth = 0): ErrorShape | string => {
  if (!(error instanceof Error) || depth > 2) return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
  const shape: ErrorShape = { name: error.name, message: error.message }
  if (error.stack) shape.stack = error.stack
  const details = errorCallDetails(error)
  if (details) shape.details = details
  const nestedSource: unknown = error.cause ?? (error as Error & { lastError?: unknown }).lastError
  if (nestedSource instanceof Error) {
    const nested = serializeError(nestedSource, depth + 1)
    if (typeof nested !== 'string') shape.cause = nested
  } else if (nestedSource !== undefined) {
    shape.cause = { name: 'Cause', message: String(nestedSource) }
  }
  return shape
}

const closeActiveDest = (): void => {
  if (isClosable(activeDest)) {
    try {
      activeDest.end()
    } catch {}
  }
  activeDest = undefined
}

export const getLogPath = (): string | undefined => activePath

export const flushLogger = (): void => {
  try {
    const dest = activeDest as { flushSync?: () => void } | undefined
    if (typeof dest?.flushSync === 'function') {
      try {
        dest.flushSync()
        return
      } catch {}
    }
    const logger = activeLogger as { flush?: () => void } | undefined
    if (typeof logger?.flush === 'function') logger.flush()
  } catch {}
}

export const getLogger = (): Logger => {
  if (!activeLogger) initLogger()
  const current = activeLogger
  if (!current) throw new Error('Logger is unavailable')
  return current
}

export const logError = (error: unknown, context?: LogContext): void => {
  try {
    getLogger().error({ ...context, error: serializeError(error) })
  } catch {}
}

export const logWarn = (message: string, context?: LogContext): void => {
  try {
    getLogger().warn({ ...context }, message)
  } catch {}
}

export const logInfo = (message: string, context?: LogContext): void => {
  try {
    getLogger().info({ ...context }, message)
  } catch {}
}

export const logDebug = (message: string, context?: LogContext): void => {
  try {
    getLogger().debug({ ...context }, message)
  } catch {}
}

export const installGlobalErrorHandlers = (): void => {
  if (handlersInstalled) return
  handlersInstalled = true
  uncaughtHandler = (error: Error): void => {
    try {
      getLogger().fatal({ error: serializeError(error), argv: process.argv, cwd: process.cwd() }, 'uncaughtException')
    } catch {}
    process.exitCode = 1
  }
  rejectionHandler = (reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (message.trim() === BENIGN_STREAM_CLOSE_MESSAGE) return
    try {
      getLogger().error({ error: serializeError(reason), argv: process.argv, cwd: process.cwd() }, 'unhandledRejection')
    } catch {}
  }
  warningHandler = (warning: Error): void => {
    try {
      getLogger().warn({ error: serializeError(warning) }, 'process warning')
    } catch {}
  }
  process.on('uncaughtException', uncaughtHandler)
  process.on('unhandledRejection', rejectionHandler)
  process.on('warning', warningHandler)
}

export const closeLogger = (): void => {
  if (uncaughtHandler) {
    try {
      process.off('uncaughtException', uncaughtHandler)
    } catch {}
    uncaughtHandler = undefined
  }
  if (rejectionHandler) {
    try {
      process.off('unhandledRejection', rejectionHandler)
    } catch {}
    rejectionHandler = undefined
  }
  if (warningHandler) {
    try {
      process.off('warning', warningHandler)
    } catch {}
    warningHandler = undefined
  }
  handlersInstalled = false
  closeActiveDest()
  activeLogger = undefined
  activePath = undefined
  activeRunId = undefined
  activeSystemDir = undefined
}

export const initLogger = (init: LoggerInit = {}): string => {
  const systemDir = resolveSystemDir(init.systemDir ?? activeSystemDir)
  const runId = sanitizeRunId(init.runId ?? activeRunId ?? `pid-${process.pid}`)
  if (activeLogger && activePath && activeRunId === runId && activeSystemDir === systemDir) return activePath
  try {
    mkdirSync(systemDir, { recursive: true })
  } catch {}
  const fileName = buildLogFileName(runId, new Date())
  const path = join(systemDir, fileName)
  closeActiveDest()
  let dest: unknown
  try {
    dest = pino.destination({ dest: path, sync: false })
  } catch {
    dest = undefined
  }
  activeDest = dest
  activeLogger = dest ? pino({ level: 'trace', base: { pid: process.pid } }, dest as pino.DestinationStream) : pino({ level: 'trace', enabled: false })
  activePath = path
  activeRunId = runId
  activeSystemDir = systemDir
  installGlobalErrorHandlers()
  try {
    activeLogger.info({ runId, pid: process.pid, argv: process.argv, cwd: process.cwd() }, 'logger started')
  } catch {}
  pruneOldLogs(systemDir, path)
  return path
}

export const setLogRunId = (runId: string, systemDir?: string): string => {
  const next = sanitizeRunId(runId)
  const dir = resolveSystemDir(systemDir ?? activeSystemDir)
  if (activeRunId === next && activeSystemDir === dir && activePath) return activePath
  const previousPath = activePath
  const previousRunId = activeRunId
  const shouldAdopt = Boolean(previousPath && previousRunId?.startsWith('pid-'))
  let previousBody: string | undefined
  if (previousPath && activeLogger) {
    try {
      activeLogger.info({ previousRunId, nextRunId: next }, 'log run id switched')
    } catch {}
  }
  if (shouldAdopt && previousPath) {
    flushLogger()
    try {
      previousBody = readFileSync(previousPath, 'utf8')
    } catch {}
  }
  const nextPath = initLogger({ runId: next, systemDir: dir })
  if (shouldAdopt && previousPath && previousPath !== nextPath) {
    if (previousBody && previousBody.length > 0) {
      flushLogger()
      try {
        appendFileSync(nextPath, `${previousBody}${previousBody.endsWith('\n') ? '' : '\n'}`)
      } catch {}
    }
    try {
      rmSync(previousPath, { force: true })
    } catch {}
  }
  return nextPath
}
