import type { SessionTotals } from '@agent/sessions/session-meta.ts'

export type ActiveSessionClose = {
  id: string
  hasMessages: boolean
  totals?: SessionTotals
  messageCount?: number
}

let activeSessionId: string | undefined
let activeHasMessages = false
let activeTotals: SessionTotals | undefined
let activeMessageCount = 0

export const setActiveSessionId = (id: string | undefined): void => {
  activeSessionId = id
  if (id === undefined) {
    activeHasMessages = false
    activeTotals = undefined
    activeMessageCount = 0
  }
}

export const markActiveSessionHasMessages = (): void => {
  activeHasMessages = true
}

export const setActiveSessionStats = (totals: SessionTotals, messageCount: number): void => {
  activeTotals = { ...totals, costDetails: { ...totals.costDetails, details: [...totals.costDetails.details] } }
  activeMessageCount = messageCount
  if (messageCount > 0) activeHasMessages = true
}

export const getActiveSessionClose = (): ActiveSessionClose | undefined =>
  activeSessionId ? { id: activeSessionId, hasMessages: activeHasMessages, totals: activeTotals, messageCount: activeMessageCount } : undefined
