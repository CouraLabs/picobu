import type { JSX } from '@opentui/solid/jsx-runtime'
import { theme } from '@states/theme-state.ts'
import { Show } from 'solid-js'

export interface DialogShellProps {
  title?: string
  hint?: string
  width?: number
  children: JSX.Element
}

export const DialogShell = (props: DialogShellProps) => (
  <box flexDirection="column" width={props.width} paddingX={2} paddingY={1} gap={1}>
    <Show when={props.title}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>{props.title}</text>
      </box>
    </Show>
    {props.children}
    <box border={['top']} borderColor={theme().border} flexShrink={0}>
      <text fg={theme().textMuted}>{props.hint ?? '(esc to close)'}</text>
    </box>
  </box>
)
