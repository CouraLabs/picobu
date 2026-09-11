import { theme } from '@states/theme-state.ts'
import { icons } from '@tui/themes/icons.ts'

export type StatusSeparatorProps = {
  sep?: string
}

export const StatusSeparator = (props: StatusSeparatorProps) => (
  <text fg={theme().textMuted} flexShrink={0} selectable={false}>
    {props.sep ? props.sep : icons.boxVertical}
  </text>
)
