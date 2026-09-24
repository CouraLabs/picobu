import type { LoopMessage } from '@agent/loop/create-loop.ts'
import { dialogStatus } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { ReasoningPart } from '@tui/components/session/reasoning-part.tsx'
import { icons } from '@tui/themes/icons.ts'
import { getSharedTreeSitterClientSync } from '@wrappers/treesitter-wrapper.ts'
import { isReasoningUIPart } from 'ai'
import { createMemo, createSignal, Show } from 'solid-js'

type MessagePart = LoopMessage['parts'][number]

const partContent = (part: MessagePart): string => {
  switch (part.type) {
    case 'text':
      return part.text
    case 'reasoning':
      return part.text
    default:
      return JSON.stringify(part)
  }
}

export interface MessagePartViewProps {
  role: LoopMessage['role']
  part: MessagePart
  message: LoopMessage
  onOpen?: (message: LoopMessage, part: MessagePart) => void
}

const DOUBLE_CLICK_MS = 200

export const MessagePartView = (props: MessagePartViewProps) => {
  let lastClickAt = 0

  const reasoningPart = createMemo(() => {
    const part = props.part
    if (isReasoningUIPart(part)) return part
    return null
  })

  const hoverProps = {
    onMouseUp: () => {
      if (dialogStatus().status === 'open') return
      const now = Date.now()
      if (now - lastClickAt <= DOUBLE_CLICK_MS) {
        lastClickAt = 0
        props.onOpen?.(props.message, props.part)
      } else {
        lastClickAt = now
      }
    },
  }

  return (
    <Show
      when={props.role !== 'user'}
      fallback={
        <box columnGap={1} flexDirection="row" {...hoverProps}>
          <text fg={theme().accent} flexShrink={0} selectable={false}>
            {icons.promptBig}
          </text>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <markdown syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} conceal content={partContent(props.part)} />
          </box>
        </box>
      }>
      <Show
        when={reasoningPart()}
        fallback={
          <box {...hoverProps}>
            <markdown syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} streaming={true} internalBlockMode={'top-level'} conceal content={partContent(props.part)} />
          </box>
        }>
        {(rp: () => NonNullable<ReturnType<typeof reasoningPart>>) => (
          <box {...hoverProps}>
            <ReasoningPart part={rp()} isStreamingTail={rp().state === 'streaming'} />
          </box>
        )}
      </Show>
    </Show>
  )
}
