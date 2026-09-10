import type { RGBA } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { lerpColor } from '@tui/components/shared/status-format.ts'

export const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export const thinkingColor = (thinking: string | undefined): string | RGBA => {
  const index = THINKING_LEVELS.indexOf(thinking as ThinkingLevel)
  if (index < 0) return theme().textMuted
  const t = index / (THINKING_LEVELS.length - 1)
  return lerpColor(theme().textMuted, theme().accent, t)
}
