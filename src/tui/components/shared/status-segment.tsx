import type { RGBA } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { Show } from 'solid-js'

export interface StatusSegmentProps {
  icon: string
  label?: string
  value: string
  valueColor?: string | RGBA
}

export const StatusSegment = (props: StatusSegmentProps) => (
  <box flexDirection="row" columnGap={1} flexShrink={0}>
    <text fg={props.valueColor ?? theme().text} selectable={false}>
      {props.icon}
    </text>
    <Show when={props.label}>
      <text fg={theme().textMuted} selectable={false}>
        {props.label}
      </text>
    </Show>
    <text fg={theme().textMuted}>{props.value}</text>
  </box>
)
