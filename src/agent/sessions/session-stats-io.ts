import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoopStats } from '@agent/loop/loop-stats.ts'
import { sessionsRoot } from '@agent/sessions/session-paths.ts'
import { withLock } from '@shared/lock.ts'

export const sessionStatsPath = (folderKey: string, sessionId: string): string => join(sessionsRoot(), folderKey, `${sessionId}.stats.json`)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isCost = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.input) && isFiniteNumber(value.output) && isFiniteNumber(value.cache) && isFiniteNumber(value.total)
}

const isUsage = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (!isFiniteNumber(value.inputTokens) || !isFiniteNumber(value.outputTokens) || !isFiniteNumber(value.totalTokens)) return false
  if (value.inputTokenDetails !== undefined && !isRecord(value.inputTokenDetails)) return false
  if (value.outputTokenDetails !== undefined && !isRecord(value.outputTokenDetails)) return false
  return true
}

const isUsageAndCost = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  return isUsage(value.usage) && isCost(value.cost)
}

const isStep = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (!isUsage(value.usage) || !isCost(value.cost)) return false
  if (typeof value.finishReason !== 'string') return false
  if (value.rawFinishReason !== undefined && typeof value.rawFinishReason !== 'string') return false
  return true
}

export const isLoopStats = (value: unknown): value is LoopStats => {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.steps) || !value.steps.every(isStep)) return false
  if (!isUsageAndCost(value.total) || !isUsageAndCost(value.currentTotal)) return false
  if (value.finishReason !== undefined && typeof value.finishReason !== 'string') return false
  if (value.rawFinishReason !== undefined && typeof value.rawFinishReason !== 'string') return false
  return true
}

export async function readLoopStats(folderKey: string, sessionId: string): Promise<LoopStats | undefined> {
  let raw: string
  try {
    raw = await readFile(sessionStatsPath(folderKey, sessionId), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLoopStats(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function writeLoopStats(folderKey: string, sessionId: string, stats: LoopStats): Promise<void> {
  const path = sessionStatsPath(folderKey, sessionId)
  await withLock(path, async () => {
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true })
    await writeFile(path, `${JSON.stringify(stats)}\n`)
  })
}
