import type { LoopMessage } from "@agent/loop/create-loop.ts"
import { SessionManager } from "@agent/sessions/session-manager.ts"
import type { Session } from "@agent/sessions/session.ts"
import { isWaiting } from "@agent/sessions/session-meta.ts"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { ToolFlowResponse } from "@tui/components/session/tools/tool-part.tsx"
import { SessionStatus, THINKING_LEVELS } from "@tui/components/session/session-status.tsx"
import { SessionPrompt } from "@tui/components/session/session-prompt.tsx"
import { ModelSelect } from "@tui/components/session/model-select.tsx"
import { openMessageActions } from "@tui/components/session/message-actions.tsx"
import { closeDialog, dialogStatus, openDialog } from "@states/dialog.state.ts"
import { theme } from "@states/theme-state.ts"
import { useKeyboard } from "@opentui/solid"
import type { ProviderModelReasoningEffort } from "@config/options.ts"
import { createSignal, onCleanup, onMount } from "solid-js"

export type SessionPageProps = {
  sessionId?: string
  visible: boolean
}

const AGENT_CYCLE = ["ask", "coder", "plan-code"]

const showError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  openDialog(() => (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme().error}>Something went wrong</text>
      <text fg={theme().text}>{message}</text>
      <text fg={theme().textMuted}>(esc to close)</text>
    </box>
  ))
}

export const SessionPage = (props: SessionPageProps) => {
  const [session, setSession] = createSignal<Session | undefined>(undefined)
  const [messages, setMessages] = createSignal<LoopMessage[]>([])
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [waiting, setWaiting] = createSignal(false)
  const [answering, setAnswering] = createSignal(false)
  const [activeId, setActiveId] = createSignal<string | undefined>(props.sessionId)
  const [agentId, setAgentId] = createSignal<string | undefined>(undefined)
  const [modelKey, setModelKey] = createSignal<string | undefined>(undefined)
  const [thinking, setThinking] = createSignal<ProviderModelReasoningEffort | undefined>(undefined)
  const sessionMgr = new SessionManager()

  useKeyboard((key) => {
    if (dialogStatus().status === "open") return
    const target = session()
    if (!target) return

    if (key.name === "tab" && !key.shift) {
      key.preventDefault()
      try {
        const current = AGENT_CYCLE.indexOf(agentId() ?? target.config.agentId)
        const next = AGENT_CYCLE[(current + 1) % AGENT_CYCLE.length] ?? AGENT_CYCLE[0]!
        target.switchAgent(next)
        setAgentId(next)
      } catch (error) {
        showError(error)
      }
      return
    }
    if (key.name === "tab" && key.shift) {
      key.preventDefault()
      try {
        const current = THINKING_LEVELS.indexOf(thinking() as (typeof THINKING_LEVELS)[number])
        const len = THINKING_LEVELS.length
        const next = THINKING_LEVELS[current < 0 ? len - 1 : (current - 1 + len) % len] ?? THINKING_LEVELS[0]!
        target.switchThinking(next)
        setThinking(next)
      } catch (error) {
        showError(error)
      }
      return
    }
    if (key.ctrl && key.name === "m") {
      key.preventDefault()
      openDialog(() => (
        <ModelSelect
          currentModelKey={modelKey()}
          onSelect={(selected) => {
            try {
              target.switchModel(selected)
            } catch (error) {
              showError(error)
              return
            }
            setModelKey(selected)
            closeDialog()
          }}
        />
      ))
    }
  })

  onMount(() => {
    void openSession(activeId())
    onCleanup(() => {
      session()?.close()
    })
  })

  const openSession = async (id?: string) => {
    try {
      const session = await sessionMgr.startSession({
        id,
        onChange: (state) => {
          setMessages([...state.messages])
          const streaming = state.status === "submitted" || state.status === "streaming"
          setIsStreaming(() => streaming)
          if (streaming || state.status === "error") setAnswering(false)
          setWaiting(() => isWaiting(state.messages))
        },
      })
      setSession(session)
      setActiveId(session.id)
      setAgentId(session.config.agentId)
      setModelKey(session.config.modelKey)
      setThinking(session.config.thinking)
    } catch (error) {
      showError(error)
    }
  }
  const handlePrompt = async (text: string) => {
    const target = session()
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"))
      return
    }
    if (waiting() || answering()) {
      try {
        target.queue(text)
      } catch (error) {
        showError(error)
      }
      return
    }
    if (target.status === "submitted" || target.status === "streaming") {
      target.queue(text)
      return
    }
    try {
      await target.sendMessage({ parts: [{ type: "text", text }] })
    } catch (error) {
      showError(error)
    }
    if (target.error) showError(target.error)
  }

  const handleFlowResponse = async (response: ToolFlowResponse) => {
    const target = session()
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"))
      return
    }
    setAnswering(true)
    try {
      if (response.tool === "plan-write" && response.output.status === "approved") {
        target.setPlanHandoffCompact(response.compact !== false)
      }
      await target.respondFlowTool({
        tool: response.tool,
        toolCallId: response.toolCallId,
        output: response.output,
      })
    } catch (error) {
      showError(error)
      throw error
    } finally {
      setAnswering(false)
    }
    if (target.error) showError(target.error)
  }

  const handleRevert = (messageId: string) => {
    const target = session()
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"))
      return
    }
    try {
      target.revertToMessage(messageId)
      closeDialog()
    } catch (error) {
      showError(error)
    }
  }

  const handleFork = async (messageId: string) => {
    const target = session()
    if (!target) {
      showError(new Error("Session is not ready yet, please try again"))
      return
    }
    try {
      const { sessionId: forkId } = await sessionMgr.forkSession(target.id, { upToMessageId: messageId })
      closeDialog()
      await target.close()
      setSession(undefined)
      setMessages([])
      setIsStreaming(false)
      setWaiting(false)
      setAnswering(false)
      await openSession(forkId)
    } catch (error) {
      showError(error)
    }
  }

  return (
    <box flexDirection="row" flexGrow={1} flexShrink={1} visible={props.visible}>
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <SessionMessages
          messages={messages()}
          isStreaming={isStreaming()}
          onFlowResponse={handleFlowResponse}
          onMessageOpen={(message) =>
            openMessageActions({ message, onRevert: handleRevert, onFork: (id) => void handleFork(id) })
          }
        />
        <SessionPrompt onPrompt={handlePrompt} streaming={isStreaming()} waiting={waiting() || answering()} />
        <SessionStatus
          agentId={agentId()}
          modelKey={modelKey()}
          thinking={thinking()}
          messages={messages()}
          streaming={isStreaming()}
        />
      </box>
    </box>
  )
}
