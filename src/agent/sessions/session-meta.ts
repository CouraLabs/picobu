export {
  deleteSessionMeta,
  folderKeyForSession,
  readSessionMeta,
  recoverSessionMeta,
  sessionMetaPath,
  updateSessionMeta,
  writeSessionMeta,
} from '@agent/sessions/session-meta-io.ts'
export type { SessionMeta, SessionState } from '@agent/sessions/session-meta-schema.ts'

export const BLOCKING_FLOW_TOOLS: ReadonlyArray<string> = ['ask', 'plan-write']
interface LooseToolPart {
  type: string
  toolName?: unknown
  output?: unknown
}

export function isWaiting(messages: Array<{ role: string; parts: Array<unknown> }>): boolean {
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return false
  return last.parts.some((raw) => {
    const part = raw as LooseToolPart
    if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return false
    const name = part.type === 'dynamic-tool' ? String(part.toolName ?? '') : part.type.slice('tool-'.length)
    if (!BLOCKING_FLOW_TOOLS.includes(name)) return false
    const output = part.output
    return typeof output === 'object' && output !== null && (output as { status?: unknown }).status === 'pending'
  })
}
