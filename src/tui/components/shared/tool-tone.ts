import { theme } from '@states/theme-state.ts'
import type { ToolTone } from '@tui/components/session/tools/tool-summary.ts'

export const toneColor = (tone: ToolTone) => {
  switch (tone) {
    case 'running':
      return theme().warning
    case 'success':
      return theme().success
    case 'error':
      return theme().error
    case 'warning':
      return theme().warning
    case 'info':
      return theme().info
    default:
      return theme().textMuted
  }
}
