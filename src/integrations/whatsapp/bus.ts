export type InboundEvent = {
  source: 'whatsapp'
  title: string
  text: string
}
type Listener = (event: InboundEvent) => void
const listeners = new Set<Listener>()
const pending: InboundEvent[] = []
const MAX_PENDING = 100

const pushPending = (event: InboundEvent): void => {
  if (pending.length >= MAX_PENDING) pending.shift()
  pending.push(event)
}

export const subscribeInbound = (fn: Listener): (() => void) => {
  listeners.add(fn)
  drainInbound(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const emitInbound = (event: InboundEvent): void => {
  if (listeners.size === 0) {
    pushPending(event)
    return
  }
  for (const fn of listeners) fn(event)
}

export const drainInbound = (fn: Listener): void => {
  while (pending.length) {
    const event = pending.shift()
    if (event) fn(event)
  }
}
