import { theme } from '@states/theme-state.ts'
import { icons } from '@tui/themes/icons.ts'

export interface StatusSeparatorProps {
  sep?: string
  selectable?: boolean
}

export const StatusSeparator = (props: StatusSeparatorProps) => (
  <text fg={theme().textMuted} flexShrink={0} selectable={props.selectable === undefined ? undefined : props.selectable}>
    {props.sep ? props.sep : icons.boxVertical}
  </text>
)
