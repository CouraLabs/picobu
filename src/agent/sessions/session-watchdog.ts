import { isWaiting } from '@agent/sessions/session-meta.ts'

export const DEFAULT_STALE_TIMEOUT_MS = 5 * 60 * 1000

type WatchdogMessage = {
  role: string
  parts: unknown[]
  metadata?: { finishReason?: unknown } | null
}

type LooseTextPart = {
  type?: unknown
  text?: unknown
}

export const hasFinishStep = (messages: WatchdogMessage[]): boolean => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata
    if (!meta) continue
    if (typeof meta.finishReason === 'string' && meta.finishReason.length > 0) return true
  }
  return false
}

export const lastAssistantText = (messages: WatchdogMessage[]): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== 'assistant') continue
    const texts: string[] = []
    for (const raw of message?.parts ?? []) {
      const part = raw as LooseTextPart
      if (part.type !== 'text' || typeof part.text !== 'string') continue
      if (part.text.trim().length === 0) continue
      texts.push(part.text)
    }
    if (texts.length > 0) return texts.join('\n')
    return undefined
  }
  return undefined
}

export type StaleCheck = {
  status: string
  messages: WatchdogMessage[]
  error?: unknown
  lastActivityAt: number
  now: number
  staleTimeoutMs: number
}

export const isSessionStale = (check: StaleCheck): boolean => {
  if (check.status !== 'submitted' && check.status !== 'streaming') return false
  if (check.error) return false
  if (isWaiting(check.messages as { role: string; parts: unknown[] }[])) return false
  if (check.now - check.lastActivityAt < check.staleTimeoutMs) return false
  if (hasFinishStep(check.messages)) return false
  if (lastAssistantText(check.messages) !== undefined) return false
  return true
}

export type SessionWatchdog = {
  recordActivity: (at?: number) => void
  reset: (at?: number) => void
  isStale: (input: { status: string; messages: WatchdogMessage[]; error?: unknown; now?: number }) => boolean
  shouldNotifyStale: (input: { status: string; messages: WatchdogMessage[]; error?: unknown; now?: number }) => boolean
  shouldSendContinue: (input: { status: string; messages: WatchdogMessage[]; error?: unknown; now?: number }) => boolean
}

export const createSessionWatchdog = (opts?: { staleTimeoutMs?: number }): SessionWatchdog => {
  const staleTimeoutMs = typeof opts?.staleTimeoutMs === 'number' && Number.isFinite(opts.staleTimeoutMs) ? Math.max(5000, Math.floor(opts.staleTimeoutMs)) : DEFAULT_STALE_TIMEOUT_MS
  let lastActivityAt = Date.now()
  let staleNotified = false
  let continueSent = false
  const checkStale = (input: { status: string; messages: WatchdogMessage[]; error?: unknown; now?: number }): boolean =>
    isSessionStale({ status: input.status, messages: input.messages, error: input.error, lastActivityAt, now: input.now ?? Date.now(), staleTimeoutMs })
  return {
    recordActivity: (at = Date.now()) => {
      lastActivityAt = at
      staleNotified = false
      continueSent = false
    },
    reset: (at = Date.now()) => {
      lastActivityAt = at
      staleNotified = false
      continueSent = false
    },
    isStale: (input) => checkStale(input),
    shouldNotifyStale: (input) => {
      if (!checkStale(input)) return false
      if (staleNotified) return false
      staleNotified = true
      return true
    },
    shouldSendContinue: (input) => {
      if (!checkStale(input)) return false
      if (continueSent) return false
      continueSent = true
      return true
    },
  }
}
