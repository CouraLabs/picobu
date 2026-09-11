import type { CloseMessageStatus } from '@tui/themes/logo.ts'

export type ExitStatus = { sessionId: string } & CloseMessageStatus

let pending: ExitStatus | undefined

export const setExitStatus = (status: ExitStatus | undefined): void => {
  pending = status
}

export const takeExitStatus = (): ExitStatus | undefined => {
  const next = pending
  pending = undefined
  return next
}
