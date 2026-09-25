import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { createMemo, For, Show } from 'solid-js'
import { permissionPreview } from './tool-summary.ts'

export interface PermissionPromptProps {
  model: string
  toolName: string
  input: unknown
  highlight: number
  onYes: () => void
  onNo: () => void
  onAlwaysAllow: () => void
}

export const PermissionPrompt = (props: PermissionPromptProps) => {
  const lines = createMemo(() => permissionPreview(props.toolName, props.input).split('\n'))
  const buttons: Array<{ label: string; onClick: () => void }> = [
    { label: 'Yes', onClick: props.onYes },
    { label: 'Nope', onClick: props.onNo },
    { label: 'Always Allow', onClick: props.onAlwaysAllow },
  ]

  return (
    <box flexDirection="column" flexShrink={0} border borderStyle="rounded" borderColor={theme().warning} paddingX={1}>
      <text fg={theme().warning} selectable={false}>
        {`The ${props.model} is asking the permission to execute the tool ${props.toolName}`}
      </text>
      <Show when={lines().length > 0 && lines()[0] !== ''}>
        <For each={lines()}>{(line) => <text fg={theme().text}>{line}</text>}</For>
      </Show>
      <box flexDirection="row" columnGap={1} marginTop={1}>
        <For each={buttons}>{(button, index) => <Button label={button.label} isActive={props.highlight === index()} onClick={button.onClick} />}</For>
      </box>
      <text fg={theme().textMuted} selectable={false}>
        {'enter = select · esc = Nope · ← → change'}
      </text>
    </box>
  )
}
