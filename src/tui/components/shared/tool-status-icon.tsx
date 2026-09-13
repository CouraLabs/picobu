import type { RGBA } from '@opentui/core'
import { Show } from 'solid-js'
import 'opentui-spinner/solid'

export interface ToolStatusIconProps {
  running: boolean
  color: string | RGBA
  icon: string
}

export const ToolStatusIcon = (props: ToolStatusIconProps) => (
  <Show
    when={props.running}
    fallback={
      <box flexShrink={0}>
        <text fg={props.color} selectable={false}>
          {props.icon}
        </text>
      </box>
    }>
    <box flexShrink={0}>
      <spinner name="toggle3" color={props.color} />
    </box>
  </Show>
)
