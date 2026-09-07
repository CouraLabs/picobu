import { SessionManager } from "@agent/sessions/session-manager.ts"
import type { Session } from "@agent/sessions/session.ts"
import { SessionHeader } from "@tui/components/session/session-header.tsx"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import { SessionPrompt } from "@tui/components/session/session-prompt.tsx"
import { SessionStatus } from "@tui/components/session/session-status.tsx"
import { createSignal, onCleanup, onMount } from "solid-js"

export type SessionPageProps = {
  sessionId?: string
  visible: boolean
}

export const SessionPage = ({ sessionId, visible }: SessionPageProps) => {
  const [session, setSession] = createSignal<Session | undefined>(undefined)
  const sessionMgr = new SessionManager()
  
  onMount(async () => {
    const session = await sessionMgr.startSession({ id: sessionId })
    setSession(session)
  })

  onCleanup(() => {
    session()?.close()
  })

  return (
    <box flexDirection="column" gap={1} visible={visible}>
      <SessionHeader />
      <SessionMessages />
      <SessionPrompt />
      <SessionStatus />
    </box>
  )
}