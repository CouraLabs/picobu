import type { UIMessage } from 'ai'

const KEEP_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied', 'approval-responded'])

function isPreliminaryToolPart(part: unknown): boolean {
  return typeof part === 'object' && part !== null && 'preliminary' in part && part.preliminary === true
}

export function sanitizeMessages<M extends UIMessage>(messages: Array<M>): Array<M> {
  return messages.flatMap((m) => {
    const parts = m.parts.filter((part) => {
      if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return true
      if (isPreliminaryToolPart(part)) return false
      return 'state' in part && KEEP_TOOL_STATES.has(part.state ?? '')
    })
    return parts.length ? [{ ...m, parts }] : []
  })
}

export function stripUnreplayableReasoning<M extends UIMessage>(messages: Array<M>): Array<M> {
  return messages.map((m) => {
    if (m.role !== 'assistant') return m
    let changed = false
    const parts = m.parts.filter((part) => {
      if (part.type !== 'reasoning') return true
      const meta = (part as { providerMetadata?: { anthropic?: { signature?: unknown; redactedData?: unknown } } }).providerMetadata
      const replayable = Boolean(meta?.anthropic?.signature || meta?.anthropic?.redactedData)
      if (!replayable) changed = true
      return replayable
    })
    return changed ? { ...m, parts } : m
  })
}

export function hasVisibleResponse(m: UIMessage): boolean {
  return m.parts.some((part) => {
    if (part.type === 'text') return part.text.trim().length > 0
    if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      if (isPreliminaryToolPart(part)) return false
      return 'state' in part && KEEP_TOOL_STATES.has(part.state ?? '')
    }
    return false
  })
}

export function lastAssistantText(messages: Array<UIMessage>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.role !== 'assistant') continue
    const text = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return undefined
}

export function dropUnansweredPrompt<M extends UIMessage>(messages: Array<M>): Array<M> {
  const last = messages[messages.length - 1]
  if (!last) return messages
  if (last.role === 'assistant' && !hasVisibleResponse(last)) {
    const prev = messages[messages.length - 2]
    if (prev?.role === 'user') return messages.slice(0, -2)
    return messages.slice(0, -1)
  }
  if (last.role === 'user') return messages.slice(0, -1)
  return messages
}

const RUNNING_TOOL_STATES = new Set(['input-streaming', 'input-available'])

export function settleAbortedToolParts<M extends UIMessage>(messages: Array<M>): Array<M> {
  let changed = false
  const out = messages.map((m) => {
    let messageChanged = false
    const parts = m.parts.map((part) => {
      const loose = part as { type?: unknown; state?: unknown }
      const isTool = loose.type === 'dynamic-tool' || (typeof loose.type === 'string' && loose.type.startsWith('tool-'))
      if (!isTool || !RUNNING_TOOL_STATES.has(loose.state as string)) return part
      messageChanged = true
      return { ...part, state: 'output-error', errorText: 'Aborted' } as M['parts'][number]
    })
    if (!messageChanged) return m
    changed = true
    return { ...m, parts } as M
  })
  return changed ? out : messages
}

export function settleStreamingParts<M extends UIMessage>(messages: Array<M>): Array<M> {
  let changed = false
  const out = messages.map((m) => {
    let messageChanged = false
    const parts = m.parts.map((part) => {
      const loose = part as { type?: unknown; state?: unknown }
      if ((loose.type === 'text' || loose.type === 'reasoning') && loose.state === 'streaming') {
        messageChanged = true
        return { ...part, state: 'done' } as M['parts'][number]
      }
      return part
    })
    if (!messageChanged) return m
    changed = true
    return { ...m, parts } as M
  })
  return changed ? out : messages
}

export function stripAnalysedImages<M extends UIMessage>(messages: Array<M>): Array<M> {
  let changed = false
  const out = messages.map((m) => {
    let messageChanged = false
    const parts = (m.parts ?? []).flatMap((part) => {
      const loose = part as { type?: unknown; mediaType?: unknown; filename?: unknown }
      if (loose.type !== 'file') return [part]
      if (typeof loose.mediaType !== 'string' || !loose.mediaType.startsWith('image/')) return [part]
      messageChanged = true
      const name = typeof loose.filename === 'string' && loose.filename.length > 0 ? ` ${loose.filename}` : ''
      return [{ type: 'text', text: `[image${name} removed from context after analysis]` } as M['parts'][number]]
    })
    if (!messageChanged) return m
    changed = true
    return { ...m, parts } as M
  })
  return changed ? out : messages
}
