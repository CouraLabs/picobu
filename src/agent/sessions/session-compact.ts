import type { LoopMessage } from '@agent/loop/create-loop.ts'
import { isWaiting } from '@agent/sessions/session-meta.ts'
import type { LanguageModelUsage } from 'ai'

export const COMPACTION_THRESHOLD = 0.85
export const KEEP_RECENT_TOKENS = 20000
export const MIN_SUMMARIZE_MESSAGES = 2
const COMPACTION_METADATA_KEY = 'compaction'

export interface CompactionMarkerData {
  tokensBefore: number
  compactedAt: number
  summarizedCount: number
  keptFromId?: string
}

export interface CompactionResult {
  compacted: boolean
  summary?: string
  markerId?: string
  tokensBefore?: number
  summarizedCount?: number
}

export interface CompactionPlan {
  tokens: number
  cut: number
  start: number
}

export const estimateTokensForText = (text: string): number => Math.ceil(text.length / 4)

const partSize = (part: unknown): number => {
  if (typeof part !== 'object' || part === null) return 0
  const typed = part as { type?: unknown; text?: unknown }
  if (typed.type === 'text' && typeof typed.text === 'string') return typed.text.length
  try {
    const json = JSON.stringify(part)
    return typeof json === 'string' ? json.length : 0
  } catch {
    return 0
  }
}

export const estimateMessageTokens = (message: LoopMessage): number => {
  const parts = Array.isArray(message.parts) ? message.parts : []
  return Math.ceil(parts.reduce((sum, part) => sum + partSize(part), 0) / 4)
}

export const usageContextTokens = (usage: LanguageModelUsage): number => (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)

export const estimateContextTokens = (messages: Array<LoopMessage>, lastUsage?: LanguageModelUsage): number => {
  if (lastUsage) return usageContextTokens(lastUsage)
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

export const isCompactionMarker = (message: LoopMessage): boolean => {
  const metadata = (message as { metadata?: unknown }).metadata
  return typeof metadata === 'object' && metadata !== null && COMPACTION_METADATA_KEY in metadata
}

export const lastMarkerIndex = (messages: Array<LoopMessage>): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && isCompactionMarker(message)) return i
  }
  return -1
}

export const findCutIndex = (messages: Array<LoopMessage>, keepTokens: number): number => {
  const start = lastMarkerIndex(messages) + 1
  let accumulated = 0
  let candidate = -1
  for (let i = messages.length - 1; i >= start; i--) {
    const message = messages[i]
    if (!message) continue
    accumulated += estimateMessageTokens(message)
    if (accumulated >= keepTokens) {
      candidate = i
      break
    }
  }
  if (candidate < 0) return -1
  for (let j = candidate; j < messages.length; j++) {
    const message = messages[j]
    if (message?.role === 'user' && !isCompactionMarker(message)) return j
  }
  return candidate
}

export const cutForSend = <M extends LoopMessage>(messages: Array<M>): Array<M> => {
  const index = lastMarkerIndex(messages)
  return index < 0 ? messages : messages.slice(index)
}

export const planCompaction = (messages: Array<LoopMessage>, lastUsage: LanguageModelUsage | undefined, contextWindow: number, force: boolean): CompactionPlan | undefined => {
  if (messages.length === 0 || isWaiting(messages)) return undefined
  const tokens = estimateContextTokens(messages, lastUsage)
  if (!force && (!(contextWindow > 0) || tokens < COMPACTION_THRESHOLD * contextWindow)) return undefined
  const cut = findCutIndex(messages, KEEP_RECENT_TOKENS)
  if (cut < 0) return undefined
  const start = lastMarkerIndex(messages) + 1
  if (cut - start < MIN_SUMMARIZE_MESSAGES) return undefined
  return { tokens, cut, start }
}

export const buildMarker = (id: string, summary: string, data: CompactionMarkerData): LoopMessage =>
  ({ id, role: 'user', metadata: { [COMPACTION_METADATA_KEY]: data }, parts: [{ type: 'text', text: summary }] }) as LoopMessage
