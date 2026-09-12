import type { LoopMessage } from '@agent/loop/create-loop.ts'
import type { RGBA } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { isSpawnTool, isToolPart } from '@tui/components/session/tools/tool-summary.ts'

export type ActivityKind = 'prompting' | 'reasoning' | 'tooling' | 'delegating' | 'answering'

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  prompting: 'Prompting',
  reasoning: 'Reasoning',
  tooling: 'Tooling',
  delegating: 'Delegating',
  answering: 'Answering',
}

interface ActivityPart {
  type?: unknown
  state?: unknown
  preliminary?: unknown
}

const isActiveToolState = (part: ActivityPart): boolean => {
  if (part.preliminary === true && part.state === 'output-available') return true
  switch (part.state) {
    case 'output-available':
    case 'output-error':
    case 'output-denied':
      return false
    default:
      return true
  }
}

export const getActivity = (messages: Array<LoopMessage>, streaming: boolean | undefined): ActivityKind | undefined => {
  if (!streaming) return undefined
  if (messages.length === 0) return 'prompting'
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return 'prompting'
  const parts = last.parts ?? []
  if (parts.length === 0) return 'prompting'
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] as ActivityPart
    if (!part || typeof part.type !== 'string') continue
    if (isToolPart(part)) {
      if (isActiveToolState(part)) return isSpawnTool(part) ? 'delegating' : 'tooling'
      continue
    }
    if (part.type === 'reasoning') {
      if (part.state === 'streaming') return 'reasoning'
      continue
    }
    if (part.type === 'text' && part.state === 'streaming') return 'answering'
  }
  return 'prompting'
}

export const getFinishReason = (finishReason?: string, messages?: Array<LoopMessage>, streaming?: boolean): string | undefined => {
  const activity = getActivity(messages ?? [], streaming)
  if (activity) return ACTIVITY_LABELS[activity]
  return finishReason
}

export const getFinishColor = (reason: string | undefined): string | RGBA => {
  switch (reason) {
    case ACTIVITY_LABELS.prompting:
      return theme().info
    case ACTIVITY_LABELS.reasoning:
      return theme().secondary
    case ACTIVITY_LABELS.tooling:
      return theme().primary
    case ACTIVITY_LABELS.delegating:
      return theme().accent
    case ACTIVITY_LABELS.answering:
      return theme().success
    case 'stop':
      return theme().success
    case 'tool-calls':
      return theme().info
    case 'length':
      return theme().warning
    case 'error':
    case 'content-filter':
      return theme().error
    default:
      return theme().textMuted
  }
}
