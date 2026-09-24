import type { LoopMessage } from '@agent/loop/create-loop.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import type { BoxRenderable } from '@opentui/core'
import type { BoxProps } from '@opentui/solid'
import { theme } from '@states/theme-state.ts'
import { MessagePartView } from '@tui/components/session/message-part.tsx'
import { type ToolFlowResponse, ToolPart } from '@tui/components/session/tools/tool-part.tsx'
import { asToolPart, isToolPart, type ToolPartLike } from '@tui/components/session/tools/tool-summary.ts'
import { createMemo, createSignal, Index, Show } from 'solid-js'

export interface SessionMessagesProps {
  messages: Array<LoopMessage>
  isStreaming?: boolean
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
  onMessageOpen?: (message: LoopMessage) => void
  onOpenSubSession?: (sessionId: string, label: string) => void
  manager?: SessionManager
}

type MessagePart = LoopMessage['parts'][number]

interface RenderPart {
  role: LoopMessage['role']
  part: MessagePart
  message: LoopMessage
  key: string
  isLastMessage: boolean
  wasToolPrevious: boolean
}

export const SessionMessages = (props: SessionMessagesProps) => {
  const allMessageParts = createMemo<Array<RenderPart>>(() => {
    const list = props.messages
    const last = list.length > 0 ? list[list.length - 1] : undefined
    const lastId = last?.id
    const result = list.flatMap((m) =>
      m.parts.flatMap((part, originalIndex) => {
        if (part.type !== 'text' && part.type !== 'reasoning' && !isToolPart(part)) return []
        const id = (part as { id?: unknown }).id
        const toolCallId = (part as { toolCallId?: unknown }).toolCallId
        const key = typeof id === 'string' && id.length > 0 ? id : typeof toolCallId === 'string' && toolCallId.length > 0 ? `${m.id}:${toolCallId}` : `${m.id}:${originalIndex}`
        return [{ key, part, role: m.role, message: m, isLastMessage: m.id === lastId, wasToolPrevious: false }]
      }),
    )

    return result.map((entry, index) => {
      const prevEntry = index > 0 ? result[index - 1] : undefined
      return { ...entry, wasToolPrevious: index === 0 || (isToolPart(entry.part) && isToolPart(prevEntry?.part)) }
    })
  })

  const onMouseOver = (target: BoxRenderable, entry: RenderPart) => {
    const ignoredTypes = ['tool-ask', 'tool-plan-write', 'tool-plan-exit', 'tool-grill-exit', 'tool-spawn', 'tool-skill', 'tool-rule']

    if (ignoredTypes.includes(entry.part.type)) return

    target.backgroundColor = theme().backgroundElement
  }

  const onMouseOut = (target: BoxRenderable, entry: RenderPart) => {
    target.backgroundColor = undefined
  }

  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      scrollY
      overflow="hidden"
      stickyScroll
      stickyStart="bottom"
      contentOptions={{ justifyContent: 'flex-end', paddingRight: 1 }}
      scrollbarOptions={{
        trackOptions: {
          foregroundColor: theme().primary,
          backgroundColor: theme().backgroundElement,
        },
      }}>
      <Index each={allMessageParts()}>
        {(entry) => {
          const borderProps = createMemo(() => {
            if (isToolPart(entry().part)) {
              return {
                border: ['left'],
                borderColor: theme().border,
                marginLeft: 1,
                paddingLeft: 1,
                paddingRight: 1,
              } as Partial<BoxProps>
            }
            return {}
          })

          return (
            <box
              marginTop={entry().wasToolPrevious ? 0 : 1}
              paddingX={1}
              {...borderProps()}
              onMouseOver={(e) => onMouseOver(e.currentTarget as BoxRenderable, entry())}
              onMouseOut={(e) => onMouseOut(e.currentTarget as BoxRenderable, entry())}>
              <Show when={asToolPart(entry().part)} fallback={<MessagePartView role={entry().role} part={entry().part} message={entry().message} onOpen={props.onMessageOpen} />}>
                {(toolPart: () => ToolPartLike) => (
                  <ToolPart
                    part={toolPart()}
                    partKey={entry().key}
                    isLastMessage={entry().isLastMessage}
                    onFlowResponse={props.onFlowResponse}
                    onOpenSubSession={props.onOpenSubSession}
                    manager={props.manager}
                  />
                )}
              </Show>
            </box>
          )
        }}
      </Index>
    </scrollbox>
  )
}
