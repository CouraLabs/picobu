import type { LoopStats } from '@agent/loop/create-loop.ts'
import type { LanguageModelUsage } from 'ai'

export interface StatsStatusState {
  finishReason: LoopStats['finishReason']
  warnings: LoopStats['warnings']
  headers: LoopStats['headers']
  endpoints: LoopStats['endpoints']
  rawUsage: LanguageModelUsage['raw'] | undefined
}

export interface StatsSyncState {
  status: StatsStatusState | undefined
  performance: LoopStats['performance']
  metrics: LoopStats | undefined
}

export const shouldSyncStats = (ownerId: string | undefined, liveId: string | undefined, activeId: string | undefined): boolean => {
  if (ownerId === undefined) return true
  if (liveId !== undefined && liveId === ownerId) return true
  return activeId === ownerId
}

export const toStatsState = (stats: LoopStats | undefined): StatsSyncState => {
  if (!stats) return { status: undefined, performance: undefined, metrics: undefined }
  return {
    status: {
      finishReason: stats.finishReason,
      warnings: stats.warnings,
      headers: stats.headers,
      endpoints: stats.endpoints,
      rawUsage: stats.usage?.raw,
    },
    performance: stats.performance,
    metrics: stats,
  }
}
