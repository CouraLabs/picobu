import type { RGBA } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { Show } from 'solid-js'

export interface StatusSegmentProps {
  icon?: string
  label?: string
  labelColor?: string | RGBA
  value: string
  valueColor?: string | RGBA
  selectable?: boolean
}

export const StatusSegment = (props: StatusSegmentProps) => (
  <box flexDirection="row" columnGap={1} flexShrink={0}>
    <box flexDirection="row" columnGap={0}>
      <Show when={props.icon}>
        <text fg={props.labelColor ?? theme().text} selectable={false}>
          {props.icon}
        </text>
      </Show>
      <Show when={props.label}>
        <text fg={props.labelColor ?? theme().textMuted} selectable={false}>
          {props.label}
        </text>
      </Show>
    </box>
    <text fg={props.valueColor ?? theme().text} selectable={props.selectable === undefined ? undefined : props.selectable}>
      {props.value}
    </text>
  </box>
)
