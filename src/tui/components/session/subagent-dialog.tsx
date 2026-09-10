import type { LoopMessage } from '@agent/loop/create-loop.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import { closeDialog, dialogJustClosed, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { SessionMessages } from '@tui/components/session/session-messages.tsx'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'

export type SubagentMessagesProps = {
  manager: SessionManager
  sessionId: string
  label: string
}

const SubagentMessagesDialog = (props: SubagentMessagesProps) => {
  const [messages, setMessages] = createSignal<LoopMessage[]>([])
  const [title, setTitle] = createSignal<string | undefined>(undefined)
  let settled = false

  const load = async () => {
    const live = props.manager.getSession(props.sessionId)
    if (live) {
      setMessages([...live.messages])
      if (live.title && live.title !== title()) setTitle(live.title)
      return
    }
    if (settled) return
    try {
      const loaded = await props.manager.loadMessages(props.sessionId)
      setMessages((loaded ?? []) as LoopMessage[])
    } catch {}
    try {
      const stored = await props.manager.getSessionTitle(props.sessionId)
      if (stored) setTitle(stored)
    } catch {}
    settled = true
  }

  onMount(() => {
    void load()
    const timer = setInterval(() => {
      void load()
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="column" width={132} height={38} paddingX={2} paddingY={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme().text} flexShrink={1}>
          {title() ?? props.label}
        </text>
        <text fg={theme().textMuted} flexShrink={0}>
          · {props.sessionId}
        </text>
        <Show when={title() && title() !== props.label}>
          <text fg={theme().textMuted} flexShrink={0}>
            · {props.label}
          </text>
        </Show>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <SessionMessages messages={messages()} />
      </box>
      <box border={['top']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().textMuted}>(esc to close)</text>
      </box>
    </box>
  )
}

export const openSubagentMessages = (props: SubagentMessagesProps) => {
  if (dialogJustClosed()) return
  openDialog(() => <SubagentMessagesDialog {...props} />)
}

export const closeSubagentMessages = () => {
  closeDialog()
}
