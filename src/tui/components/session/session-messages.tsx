import type { LoopMessage } from "@agent/loop/create-loop.ts"
import { isToolPart, asToolPart, type ToolPartLike } from "@tui/components/session/tools/tool-summary.ts"
import { ToolPart, type ToolFlowResponse } from "@tui/components/session/tools/tool-part.tsx"
import { MessagePartView } from "@tui/components/session/message-part.tsx"
import { theme } from "@states/theme-state.ts"
import { createMemo, Index, Show } from "solid-js"

export type SessionMessagesProps = {
  messages: LoopMessage[]
  isStreaming?: boolean
  onFlowResponse?: (response: ToolFlowResponse) => void | Promise<void>
  onMessageOpen?: (message: LoopMessage) => void
}

type MessagePart = LoopMessage["parts"][number]

type RenderPart = {
  role: LoopMessage["role"]
  part: MessagePart
  message: LoopMessage
  key: string
  isLastMessage: boolean
}

export const SessionMessages = (props: SessionMessagesProps) => {
  const allMessageParts = createMemo<RenderPart[]>(
    () => {
      const list = props.messages
      const lastId = list.length > 0 ? list[list.length - 1]!.id : undefined
      return list.flatMap((m) => m.parts
        .filter((a) => a.type === "text" || a.type === "reasoning" || isToolPart(a))
        .map((part, pi) => {
          const id = (part as { id?: unknown }).id
          return {
            part: asToolPart(part) || part.type === "reasoning" ? { ...part } : part,
            role: m.role,
            message: m,
            key: typeof id === "string" && id.length > 0 ? id : `${m.id}:${pi}`,
            isLastMessage: m.id === lastId,
          }
        })
      )
    }
  )

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
          <Show
            when={asToolPart(entry().part)}
            fallback={<MessagePartView role={entry().role} part={entry().part} message={entry().message} onOpen={props.onMessageOpen} />}>
            {(toolPart: () => ToolPartLike) => {
              const prev = allMessageParts()[index - 1]
              const afterUserOrReasoning = prev !== undefined && (
                prev.part.type === 'text' || prev.part.type === "reasoning"
              )

              return (
                <box marginTop={afterUserOrReasoning ? 1 : 0}>
                  <ToolPart part={toolPart()} partKey={entry().key} isLastMessage={entry().isLastMessage} onFlowResponse={props.onFlowResponse} />
                </box>
              )
            }}
          </Show>
        )}
      </Index>
    </scrollbox>
  )
}
