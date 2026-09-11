export type ActiveSessionClose = {
  id: string
  hasMessages: boolean
  messageCount?: number
}

let activeSessionId: string | undefined
let activeHasMessages = false
let activeMessageCount = 0

export const setActiveSessionId = (id: string | undefined): void => {
  activeSessionId = id
  if (id === undefined) {
    activeHasMessages = false
    activeMessageCount = 0
  }
}

export const markActiveSessionHasMessages = (): void => {
  activeHasMessages = true
}

export const setActiveSessionStats = (messageCount: number): void => {
  activeMessageCount = messageCount
  if (messageCount > 0) activeHasMessages = true
}

export const getActiveSessionClose = (): ActiveSessionClose | undefined => (activeSessionId ? { id: activeSessionId, hasMessages: activeHasMessages, messageCount: activeMessageCount } : undefined)
