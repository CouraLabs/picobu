import type { LoopMessage } from '@agent/loop/create-loop.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import { theme } from '@states/theme-state.ts'
import { MessagePartView } from '@tui/components/session/message-part.tsx'
import { type ToolFlowResponse, ToolPart } from '@tui/components/session/tools/tool-part.tsx'
import { asToolPart, isToolPart, type ToolPartLike } from '@tui/components/session/tools/tool-summary.ts'
import { createMemo, For, Index, Show } from 'solid-js'

export interface SessionMessagesProps {
  messages: Array<LoopMessage>
  isStreaming?: boolean
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
  onMessageOpen?: (message: LoopMessage) => void
  onOpenSubSession?: (sessionId: string, label: string) => void
  manager?: SessionManager
}

type MessagePart = LoopMessage['parts'][number]

const renderablePart = (part: MessagePart): boolean => part.type === 'text' || part.type === 'reasoning' || isToolPart(part)

const partKey = (message: LoopMessage, part: MessagePart, originalIndex: number): string => {
  const id = (part as { id?: unknown }).id
  if (typeof id === 'string' && id.length > 0) return id
  const toolCallId = (part as { toolCallId?: unknown }).toolCallId
  if (typeof toolCallId === 'string' && toolCallId.length > 0) return `${message.id}:${toolCallId}`
  return `${message.id}:${originalIndex}`
}

interface MessagePartRow {
  role: LoopMessage['role']
  part: MessagePart
  message: LoopMessage
  key: string
  isLastMessage: boolean
  prevIsTextOrReasoning: boolean
}

const MessagePartsGroup = (props: {
  message: () => LoopMessage
  isLast: () => boolean
  prevMessageLastPart: () => MessagePart | undefined
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
  onMessageOpen?: (message: LoopMessage) => void
  onOpenSubSession?: (sessionId: string, label: string) => void
  manager?: SessionManager
}) => {
  const rows = createMemo<Array<MessagePartRow>>(() => {
    const message = props.message()
    const role = message.role
    const isLastMessage = props.isLast()
    const parts = message.parts
    const out: Array<MessagePartRow> = []
    for (const [originalIndex, part] of parts.entries()) {
      if (!renderablePart(part)) continue
      const prev = originalIndex > 0 ? parts[originalIndex - 1] : props.prevMessageLastPart()
      out.push({
        role,
        part,
        message,
        key: partKey(message, part, originalIndex),
        isLastMessage,
        prevIsTextOrReasoning: prev !== undefined && (prev.type === 'text' || prev.type === 'reasoning'),
      })
    }
    return out
  })

  return (
    <For each={rows()}>
      {(row) => (
        <Show when={asToolPart(row.part)} fallback={<MessagePartView role={row.role} part={row.part} message={row.message} onOpen={props.onMessageOpen} />}>
          {(toolPart: () => ToolPartLike) => (
            <box marginTop={row.prevIsTextOrReasoning ? 1 : 0}>
              <ToolPart part={toolPart()} partKey={row.key} isLastMessage={row.isLastMessage} onFlowResponse={props.onFlowResponse} onOpenSubSession={props.onOpenSubSession} manager={props.manager} />
            </box>
          )}
        </Show>
      )}
    </For>
  )
}

export const SessionMessages = (props: SessionMessagesProps) => {
  const lastPartOf = (message: LoopMessage | undefined): MessagePart | undefined => {
    if (!message) return undefined
    for (let i = message.parts.length - 1; i >= 0; i--) {
      const part = message.parts[i]
      if (part && renderablePart(part)) return part
    }
    return undefined
  }

  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      border={['left', 'right']}
      borderColor={theme().border}
      scrollY
      overflow="hidden"
      stickyScroll
      stickyStart="bottom"
      contentOptions={{ justifyContent: 'flex-end', paddingRight: 2 }}
      scrollbarOptions={{
        trackOptions: {
          foregroundColor: theme().primary,
          backgroundColor: theme().background,
        },
      }}>
      <Index each={props.messages}>
        {(message, index) => (
          <MessagePartsGroup
            message={message}
            isLast={() => props.messages[props.messages.length - 1]?.id === message().id}
            prevMessageLastPart={() => lastPartOf(props.messages[index - 1])}
            onFlowResponse={props.onFlowResponse}
            onMessageOpen={props.onMessageOpen}
            onOpenSubSession={props.onOpenSubSession}
            manager={props.manager}
          />
        )}
      </Index>
    </scrollbox>
  )
}
