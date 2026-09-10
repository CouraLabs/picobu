import type { LoopMessage } from '@agent/loop/create-loop.ts'
import { theme } from '@states/theme-state.ts'
import { MessagePartView } from '@tui/components/session/message-part.tsx'
import { type ToolFlowResponse, ToolPart } from '@tui/components/session/tools/tool-part.tsx'
import { asToolPart, isToolPart, type ToolPartLike } from '@tui/components/session/tools/tool-summary.ts'
import { createMemo, Index, Show } from 'solid-js'

export type SessionMessagesProps = {
  messages: LoopMessage[]
  isStreaming?: boolean
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
  onMessageOpen?: (message: LoopMessage) => void
  onOpenSubSession?: (sessionId: string, label: string) => void
}

type MessagePart = LoopMessage['parts'][number]

type RenderPart = {
  role: LoopMessage['role']
  part: MessagePart
  message: LoopMessage
  key: string
  isLastMessage: boolean
}

export const SessionMessages = (props: SessionMessagesProps) => {
  const allMessageParts = createMemo<RenderPart[]>(() => {
    const list = props.messages
    const last = list.length > 0 ? list[list.length - 1] : undefined
    const lastId = last?.id
    return list.flatMap((m) =>
      m.parts.flatMap((part, originalIndex) => {
        if (part.type !== 'text' && part.type !== 'reasoning' && !isToolPart(part)) return []
        const id = (part as { id?: unknown }).id
        const toolCallId = (part as { toolCallId?: unknown }).toolCallId
        const key = typeof id === 'string' && id.length > 0 ? id : typeof toolCallId === 'string' && toolCallId.length > 0 ? `${m.id}:${toolCallId}` : `${m.id}:${originalIndex}`
        return [
          {
            part,
            role: m.role,
            message: m,
            key,
            isLastMessage: m.id === lastId,
          },
        ]
      }),
    )
  })

  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
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
      <Index each={allMessageParts()}>
        {(entry, index) => (
          <Show when={asToolPart(entry().part)} fallback={<MessagePartView role={entry().role} part={entry().part} message={entry().message} onOpen={props.onMessageOpen} />}>
            {(toolPart: () => ToolPartLike) => {
              const prev = allMessageParts()[index - 1]
              const afterUserOrReasoning = prev !== undefined && (prev.part.type === 'text' || prev.part.type === 'reasoning')

              return (
                <box marginTop={afterUserOrReasoning ? 1 : 0}>
                  <ToolPart part={toolPart()} partKey={entry().key} isLastMessage={entry().isLastMessage} onFlowResponse={props.onFlowResponse} onOpenSubSession={props.onOpenSubSession} />
                </box>
              )
            }}
          </Show>
        )}
      </Index>
    </scrollbox>
  )
}
