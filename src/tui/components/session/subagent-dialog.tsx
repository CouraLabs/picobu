import type { LoopMessage } from '@agent/loop/create-loop.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import { dialogJustClosed, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { SessionMessages } from '@tui/components/session/session-messages.tsx'
import { getModelLabel } from '@tui/components/session/status/status-meta.ts'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'

export interface SubagentMessagesProps {
  manager: SessionManager
  sessionId: string
  label: string
}

const SubagentMessagesDialog = (props: SubagentMessagesProps) => {
  const dims = useTerminalDims()
  const [messages, setMessages] = createSignal<Array<LoopMessage>>([])
  const [title, setTitle] = createSignal<string | undefined>(undefined)
  const [model, setModel] = createSignal<string | undefined>(undefined)
  let settled = false

  const load = async () => {
    const live = props.manager.getSession(props.sessionId)
    if (live) {
      const current = messages()
      if (current.length !== live.messages.length || current.some((m, i) => m !== live.messages[i])) setMessages([...live.messages])
      if (live.title && live.title !== title()) setTitle(live.title)
      if (live.config.modelKey && live.config.modelKey !== model()) setModel(live.config.modelKey)
      return
    }
    if (settled) return
    try {
      const loaded = await props.manager.loadMessages(props.sessionId)
      setMessages((loaded ?? []) as Array<LoopMessage>)
    } catch {}
    try {
      const stored = await props.manager.getSessionTitle(props.sessionId)
      if (stored) setTitle(stored)
    } catch {}
    try {
      const storedModel = await props.manager.getSessionModel(props.sessionId)
      if (storedModel) setModel(storedModel)
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
    <box
      flexDirection="column"
      width={Math.max(20, Math.min(Math.floor(dims().width * 0.95), dims().width - 2))}
      height={Math.max(10, Math.min(Math.floor(dims().height * 0.9), dims().height - 2))}
      paddingX={2}
      paddingY={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme().text} flexShrink={1}>
          {title() ?? props.label}
        </text>
        <text fg={theme().textMuted} flexShrink={0}>
          · {props.sessionId}
        </text>
        <Show when={model()}>
          <text fg={theme().textMuted} flexShrink={0}>
            · {getModelLabel(model())}
          </text>
        </Show>
        <Show when={title() && title() !== props.label}>
          <text fg={theme().textMuted} flexShrink={0}>
            · {props.label}
          </text>
        </Show>
      </box>
      <SessionMessages messages={messages()} />
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
