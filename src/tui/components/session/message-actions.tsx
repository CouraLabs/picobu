import type { LoopMessage } from '@agent/loop/create-loop.ts'
import type { SelectOption, SelectRenderable } from '@opentui/core'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { getClipboardService } from '@tui/hooks/clipboard.state.ts'
import { onMount } from 'solid-js'

export interface MessageActionsProps {
  message: LoopMessage
  onRevert?: (messageId: string) => void
  onFork?: (messageId: string) => void
}

export const messageText = (message: LoopMessage): string =>
  message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')

export type RevertRole = 'user' | 'assistant'

export interface RevertConfirmCopy {
  title: string
  body: string
  confirm: string
}

export const revertConfirmCopy = (role: RevertRole): RevertConfirmCopy =>
  role === 'user'
    ? {
        title: 'Edit this message?',
        body: 'Removes this message and every message after it, and returns the text and files to the prompt so you can edit and resend it.',
        confirm: 'Edit',
      }
    : { title: 'Revert to this message?', body: 'Discards every message after this one from the context. This cannot be undone.', confirm: 'Revert' }

const selectWidth = 48

const MessageActionsDialog = (props: MessageActionsProps) => {
  let selectRef: SelectRenderable | null = null
  onMount(() => selectRef?.focus())

  const actions: Array<SelectOption> = [
    { name: 'Revert', description: 'Discards every message after this one', value: 'revert' },
    { name: 'Copy', description: 'Copy the message text to the clipboard', value: 'copy' },
    { name: 'Fork', description: 'Continue the conversation in a new session', value: 'fork' },
  ]

  const runAction = (option: SelectOption) => {
    switch (option.value) {
      case 'revert':
        confirmRevert()
        break
      case 'copy':
        void copy()
        break
      case 'fork':
        props.onFork?.(props.message.id)
        closeDialog()
        break
    }
  }

  const copy = async () => {
    const service = getClipboardService()
    if (!service) {
      openDialog(() => (
        <box flexDirection="column" gap={1} padding={1}>
          <text fg={theme().error}>Copy failed</text>
          <text fg={theme().text}>No clipboard service available</text>
          <text fg={theme().textMuted}>(esc to close)</text>
        </box>
      ))
      return
    }
    try {
      await service.writeText(messageText(props.message), { destination: 'all-available' })
      closeDialog()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      openDialog(() => (
        <box flexDirection="column" gap={1} padding={1}>
          <text fg={theme().error}>Copy failed</text>
          <text fg={theme().text}>{detail}</text>
          <text fg={theme().textMuted}>(esc to close)</text>
        </box>
      ))
    }
  }

  const confirmRevert = () => {
    const copy = revertConfirmCopy(props.message.role === 'user' ? 'user' : 'assistant')
    openDialog(() => (
      <box flexDirection="column" gap={1} padding={1}>
        <text fg={theme().warning}>{copy.title}</text>
        <text width={56} fg={theme().text}>
          {copy.body}
        </text>
        <box flexDirection="row" gap={1} justifyContent="flex-end" marginTop={1}>
          <Button label="Cancel" onClick={closeDialog} />
          <Button
            label={copy.confirm}
            onClick={() => {
              props.onRevert?.(props.message.id)
              closeDialog()
            }}
          />
        </box>
        <text fg={theme().textMuted}>(esc to cancel)</text>
      </box>
    ))
  }

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      <box border={['bottom']} borderColor={theme().border}>
        <text fg={theme().text}>{props.message.role === 'user' ? 'Prompt' : 'Assistant Message'}</text>
      </box>
      <select
        ref={(r: SelectRenderable) => (selectRef = r)}
        width={selectWidth}
        height={actions.length * 2}
        options={actions}
        focused
        onSelect={(_index, option) => option && runAction(option)}
        textColor={theme().text}
        descriptionColor={theme().textMuted}
        selectedBackgroundColor={theme().accent}
        selectedTextColor={theme().selected(theme().accent)}
        selectedDescriptionColor={theme().selected(theme().accent)}
      />
      <box border={['top']} borderColor={theme().border}>
        <text fg={theme().textMuted}>(esc to close)</text>
      </box>
    </box>
  )
}

export const openMessageActions = (props: MessageActionsProps) => {
  openDialog(() => <MessageActionsDialog {...props} />)
}
