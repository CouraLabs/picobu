import type { LoopMessage } from '@agent/loop/create-loop.ts'
import { dialogStatus } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { ReasoningPart } from '@tui/components/session/reasoning-part.tsx'
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
  onOpen?: (message: LoopMessage) => void
}

export const MessagePartView = (props: MessagePartViewProps) => {
  const [hovered, setHovered] = createSignal(false)
  const borderColor = () => (hovered() ? theme().accent : defaultBorderColor())

  const defaultBorderColor = () => {
    if (props.role === 'user') return theme().text
    if (reasoningPart()) return theme().textMuted
    return theme().primary
  }

  const reasoningPart = createMemo(() => {
    const part = props.part
    if (isReasoningUIPart(part)) return part
    return null
  })

  const hoverProps = {
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
    onMouseUp: () => {
      if (dialogStatus().status === 'open') return
      props.onOpen?.(props.message)
    },
  }

  return (
    <Show
      when={props.role !== 'user'}
      fallback={
        <box marginTop={1} border={['left']} borderStyle={hovered() ? 'heavy' : 'single'} borderColor={borderColor()} paddingLeft={1} {...hoverProps}>
          <markdown syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} conceal content={partContent(props.part)} />
        </box>
      }>
      <Show
        when={reasoningPart()}
        fallback={
          <box marginTop={1} border={['left']} borderStyle={hovered() ? 'heavy' : 'single'} borderColor={borderColor()} paddingLeft={1} {...hoverProps}>
            <markdown syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} streaming={true} internalBlockMode={'top-level'} conceal content={partContent(props.part)} />
          </box>
        }>
        {(rp: () => NonNullable<ReturnType<typeof reasoningPart>>) => (
          <box marginTop={1} border={['left']} borderStyle={hovered() ? 'heavy' : 'single'} borderColor={borderColor()} paddingLeft={1} {...hoverProps}>
            <ReasoningPart part={rp()} isStreamingTail={rp().state === 'streaming'} />
          </box>
        )}
      </Show>
    </Show>
  )
}
