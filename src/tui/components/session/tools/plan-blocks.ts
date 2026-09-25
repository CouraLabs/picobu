import { infoStringToFiletype } from '@opentui/core'

export type PlanSegmentKind = 'prose' | 'code'

export interface PlanSegment {
  index: number
  kind: PlanSegmentKind
  lang: string
  text: string
  startLine: number
}

export const fenceLabel = (trimmedLine: string): string => {
  const rest = trimmedLine.replace(/^[`~]+/, '').trim()
  if (rest.length === 0) return ''
  return rest.split(/\s+/)[0] ?? ''
}

export const isFence = (trimmed: string): boolean => trimmed.startsWith('```') || trimmed.startsWith('~~~')

export const planSegments = (plan: string): Array<PlanSegment> => {
  const segments: Array<PlanSegment> = []
  const lines = plan.split('\n')
  let buffer: Array<string> = []
  let inFence = false
  let lang = ''
  let kind: PlanSegmentKind = 'prose'
  let startLine = 1
  const flush = (): void => {
    const text = buffer.join('\n')
    if (text.trim().length === 0) {
      buffer = []
      return
    }
    segments.push({ index: segments.length, kind, lang: inFence ? lang : '', text, startLine })
    buffer = []
  }
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim()
    if (isFence(trimmed)) {
      if (!inFence) {
        flush()
        inFence = true
        kind = 'code'
        lang = fenceLabel(trimmed)
      } else {
        flush()
        inFence = false
        kind = 'prose'
        lang = ''
      }
      continue
    }
    if (!inFence && trimmed.length === 0) {
      flush()
      continue
    }
    if (buffer.length === 0) startLine = i + 1
    buffer.push(line)
  }
  flush()
  return segments
}

export const fenceFiletype = (lang: string): string | undefined => {
  const trimmed = lang.trim()
  if (trimmed.length === 0) return undefined
  return infoStringToFiletype(trimmed)
}

export const approvalVerdictLabel = (status: string | undefined): string => (status === 'rejected' ? 'Rejected' : 'Approved')

export const approvalBodyLines = (status: string | undefined, message: string | undefined): Array<string> => {
  const label = approvalVerdictLabel(status)
  return (message ?? '').split('\n').filter((line) => line.trim().length > 0 && line.trim() !== label)
}
