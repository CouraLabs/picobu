import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { listSubagents } from '@agent/agents/subagents.ts'
import { buildCommandPrompt } from '@agent/commands/discovery.ts'
import { listCommands } from '@agent/commands/index.ts'
import { type ParsedCommandLine, parseCommandLine } from '@agent/commands/parse-command-line.ts'
import type { LoopMessage } from '@agent/loop/create-loop.ts'
import { generateSessionTitle } from '@agent/prompts/session-title.ts'
import { closePromptHistory, projectKeyFor } from '@agent/sessions/prompt-history.ts'
import type { QueuedPrompt, Session, SessionUsage } from '@agent/sessions/session.ts'
import { SessionManager } from '@agent/sessions/session-manager.ts'
import { lastAssistantText } from '@agent/sessions/session-messages.ts'
import type { SessionTotals } from '@agent/sessions/session-meta.ts'
import { isWaiting } from '@agent/sessions/session-meta.ts'
import { createSessionWatchdog } from '@agent/sessions/session-watchdog.ts'
import { resetAuthCache } from '@auth/store.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import { options } from '@config/options.ts'
import { resetMcpAuthCache } from '@integrations/mcp/auth.ts'
import { useKeyboard, useRenderer } from '@opentui/solid'
import { setConsoleTitle } from '@shared/console-title.ts'
import { getGitInfo } from '@shared/git-info.ts'
import { notifyBlocking, notifyCompletion, notifyFailure, notifyStale } from '@shared/notify.ts'
import { bumpCatalog } from '@states/catalog-state.ts'
import { closeDialog, dialogStatus, openDialog } from '@states/dialog.state.ts'
import { flushThemeSave, theme } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { openJobsDialog } from '@tui/components/session/jobs-dialog.tsx'
import { openMessageActions } from '@tui/components/session/message-actions.tsx'
import { ModelSelect } from '@tui/components/session/model-select.tsx'
import { openRolesDialog } from '@tui/components/session/roles-dialog.tsx'
import { SessionHeader } from '@tui/components/session/session-header.tsx'
import { SessionMessages } from '@tui/components/session/session-messages.tsx'
import { type AttachedFile, type EditRequest, type PromptMode, type PromptPayload, SessionPrompt } from '@tui/components/session/session-prompt.tsx'
import { SessionQueue } from '@tui/components/session/session-queue.tsx'
import { SessionStatus, THINKING_LEVELS } from '@tui/components/session/session-status.tsx'
import { openSubagentMessages } from '@tui/components/session/subagent-dialog.tsx'
import type { ToolFlowResponse } from '@tui/components/session/tools/tool-part.tsx'
import { markActiveSessionHasMessages, setActiveSessionId, setActiveSessionStats } from '@tui/hooks/active-session.ts'
import type { CreateUIMessage } from 'ai'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'

export type SessionPageProps = {
  sessionId?: string
  visible: boolean
}

const AGENT_CYCLE = ['ask', 'coder', 'plan-code']

const ESC_WINDOW_MS = 600
const EXIT_WINDOW_MS = 2000

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

const showInfo = (title: string, body: string) => {
  openDialog(() => (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme().text}>{title}</text>
      <text fg={theme().text}>{body}</text>
      <text fg={theme().textMuted}>(esc to close)</text>
    </box>
  ))
}

type LooseFlowPart = {
  type?: unknown
  toolName?: unknown
  toolCallId?: unknown
  output?: unknown
}

const pendingFlowPart = (parts: unknown[]): { tool: 'ask' | 'plan-write'; toolCallId: string } | undefined => {
  for (const raw of parts) {
    const part = raw as LooseFlowPart
    const name = part.type === 'dynamic-tool' ? part.toolName : typeof part.type === 'string' && part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : undefined
    if (name !== 'ask' && name !== 'plan-write') continue
    const output = part.output as { status?: unknown } | undefined
    if (typeof part.toolCallId !== 'string' || part.toolCallId.length === 0) continue
    if (output?.status !== 'pending') continue
    return { tool: name, toolCallId: part.toolCallId }
  }
  return undefined
}

const lastUserText = (messages: LoopMessage[]): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    const text = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return undefined
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
  const [title, setTitle] = createSignal<string | undefined>(undefined)
  const [totals, setTotals] = createSignal<SessionTotals | undefined>(undefined)
  const [usage, setUsage] = createSignal<SessionUsage | undefined>(undefined)
  const [mcp, setMcp] = createSignal<{ connected: number; total: number; tools: number }>({ connected: 0, total: 0, tools: 0 })
  const [cwd, setCwd] = createSignal<string | undefined>(undefined)
  const [git, setGit] = createSignal<{ branch: string; additions: number; deletions: number } | null>(null)
  const [mode, setMode] = createSignal<PromptMode>('normal')
  const [queueDepth, setQueueDepth] = createSignal(0)
  const [queued, setQueued] = createSignal<QueuedPrompt[]>([])
  const [editRequest, setEditRequest] = createSignal<EditRequest | undefined>(undefined)
  const [projectKey, setProjectKey] = createSignal<string>(projectKeyFor())
  const [commandOpen, setCommandOpen] = createSignal(false)
  const [commandExitNonce, setCommandExitNonce] = createSignal(0)
  const sessionMgr = new SessionManager()
  const renderer = useRenderer()
  const watchdog = createSessionWatchdog({ staleTimeoutMs: options.watchdog.staleTimeoutMs })
  let lastEsc = 0
  let lastCtrlD = 0
  let prevStreaming = false
  let prevWaiting = false
  let prevErrorMessage: string | undefined
  const titleGenerationPending = new Set<string>()

  createEffect(() => {
    setConsoleTitle(title())
  })

  const refreshGit = (dir: string | undefined) => {
    setCwd(dir)
    setGit(dir ? getGitInfo(dir) : null)
  }

  const refreshMcp = (target: Session | undefined) => {
    if (!target) return
    target.mcp
      .servers()
      .then(async (servers) => {
        const tools = await target.mcp.tools().catch(() => ({}))
        setMcp({ connected: servers.filter((s) => s.connected).length, total: servers.length, tools: Object.keys(tools).length })
      })
      .catch(() => {})
  }

  let detachQueue: (() => void) | undefined
  let editNonce = 0

  const bytesFromDataUrl = (url: string): Uint8Array => {
    const match = /^data:[^;]+;base64,(.*)$/s.exec(url)
    if (!match) return new TextEncoder().encode(url)
    try {
      return Uint8Array.from(Buffer.from(match[1] ?? '', 'base64'))
    } catch {
      return new TextEncoder().encode(url)
    }
  }

  const attachedFromQueued = (item: QueuedPrompt): AttachedFile[] => {
    const seqs: number[] = []
    for (const match of item.text.matchAll(/\[(\d+) ([^\s\]]+) ([^\]]+)\]/g)) seqs.push(Number(match[1]))
    return item.files.map((f, index) => {
      const bytes = bytesFromDataUrl(f.url)
      return { id: `q-${item.id}-${index}`, seq: seqs[index] ?? -(index + 1), mediaType: f.mediaType, filename: f.filename ?? `queued-${index + 1}`, size: bytes.byteLength, bytes }
    })
  }

  const buildMessage = (text: string, files: AttachedFile[]): CreateUIMessage<LoopMessage> =>
    ({
      parts: [
        { type: 'text', text },
        ...files.map((f) => ({
          type: 'file' as const,
          mediaType: f.mediaType,
          filename: f.filename,
          url: `data:${f.mediaType};base64,${Buffer.from(f.bytes).toString('base64')}`,
        })),
      ],
    }) as CreateUIMessage<LoopMessage>

  const syncQueue = (target: Session) => {
    setQueued([...target.queued])
    setQueueDepth(target.queuedCount)
  }

  const attachSession = (next: Session) => {
    detachQueue?.()
    setSession(next)
    setActiveId(next.id)
    setAgentId(next.config.agentId)
    setModelKey(next.config.modelKey)
    setThinking(next.config.thinking)
    setTitle(next.title)
    setTotals({ ...next.totals })
    setUsage(next.usage ? { ...next.usage } : undefined)
    setMessages([...next.messages])
    syncQueue(next)
    setProjectKey(projectKeyFor(next.config.cwd ?? sessionMgr.currentCwd))
    detachQueue = next.onQueueChange((items) => {
      setQueued([...items])
      setQueueDepth(items.length)
    })
    setActiveSessionId(next.id)
    if (next.messages.length > 0) markActiveSessionHasMessages()
    setActiveSessionStats({ ...next.totals }, next.messages.length)
    const streaming = next.status === 'submitted' || next.status === 'streaming'
    const w = isWaiting(next.messages)
    setIsStreaming(streaming)
    setWaiting(w)
    prevStreaming = streaming
    prevWaiting = w
    prevErrorMessage = next.error?.message
    watchdog.reset()
    refreshGit(next.config.cwd ?? sessionMgr.currentCwd)
    refreshMcp(next)
  }

  const openModelDialog = () => {
    const target = session()
    if (!target) return
    openDialog(() => (
      <ModelSelect
        currentModelKey={modelKey()}
        onSelect={(selected) => {
          const previous = modelKey() ?? target.config.modelKey
          try {
            target.switchModel(selected)
          } catch (error) {
            showError(error)
            return
          }
          setModelKey(selected)
          if (previous !== selected) pushToast(`Model changed from ${previous} to ${selected}`, 'info')
          closeDialog()
        }}
      />
    ))
  }

  const cancelPendingFlow = async () => {
    const msgs = messages()
    const last = msgs[msgs.length - 1]
    if (last?.role !== 'assistant') return
    const found = pendingFlowPart(last.parts as unknown[])
    if (!found) return
    if (found.tool === 'ask') {
      await handleFlowResponse({
        tool: 'ask',
        toolCallId: found.toolCallId,
        output: { status: 'cancelled', message: 'The user dismissed the questions without answering' },
      })
    } else {
      await handleFlowResponse({
        tool: 'plan-write',
        toolCallId: found.toolCallId,
        output: { status: 'cancelled', message: 'The user dismissed the plan review' },
      })
    }
  }

  const interruptStack = async () => {
    const target = session()
    if (!target) return
    if (isWaiting(messages())) {
      try {
        await cancelPendingFlow()
      } catch (error) {
        showError(error)
      }
      return
    }
    if (target.queuedCount > 0) {
      const removed = target.dequeueNewest()
      syncQueue(target)
      if (removed && (removed.text.trim().length > 0 || removed.files.length > 0)) {
        editNonce += 1
        setEditRequest({ text: removed.text, files: attachedFromQueued(removed), nonce: editNonce })
        pushToast('Newest queued prompt moved back to the prompt for editing', 'info')
      }
      return
    }
    if (target.status === 'submitted' || target.status === 'streaming') {
      try {
        await target.stop()
      } catch (error) {
        showError(error)
      }
    }
  }

  useKeyboard((key) => {
    if (dialogStatus().status === 'open') return
    const target = session()
    if (!target) return

    if (key.name === 'escape') {
      if (commandOpen()) {
        setCommandExitNonce((n) => n + 1)
        lastEsc = 0
        return
      }
      const now = Date.now()
      if (now - lastEsc < ESC_WINDOW_MS) {
        lastEsc = 0
        key.preventDefault()
        void interruptStack()
      } else {
        lastEsc = now
      }
      return
    }
    if (key.ctrl && key.name === 'w') {
      key.preventDefault()
      setMode((m) => (m === 'steer' ? 'normal' : 'steer'))
      return
    }
    if (key.ctrl && key.name === 'd') {
      key.preventDefault()
      const now = Date.now()
      if (now - lastCtrlD < EXIT_WINDOW_MS) {
        lastCtrlD = 0
        void quitApp()
      } else {
        lastCtrlD = now
        pushToast('Press ⌃D again to exit!', 'warning')
      }
      return
    }
    if (key.ctrl && key.name === 'j') {
      key.preventDefault()
      openJobsDialog({
        manager: sessionMgr,
        onOpenSession: (id, label) => openSubagentMessages({ manager: sessionMgr, sessionId: id, label }),
      })
      return
    }
    if (key.name === 'tab' && !key.shift) {
      if (commandOpen()) return
      key.preventDefault()
      try {
        const current = AGENT_CYCLE.indexOf(agentId() ?? target.config.agentId)
        const candidate = AGENT_CYCLE[(current + 1) % AGENT_CYCLE.length] ?? AGENT_CYCLE[0]
        if (candidate === undefined) throw new Error('No agents configured')
        const next = candidate
        const previous = agentId() ?? target.config.agentId
        target.switchAgent(next)
        setAgentId(next)
        if (previous !== next) pushToast(`Agent changed from ${previous} to ${next}`, 'info')
      } catch (error) {
        showError(error)
      }
      return
    }
    if (key.name === 'tab' && key.shift) {
      key.preventDefault()
      try {
        const current = THINKING_LEVELS.indexOf(thinking() as (typeof THINKING_LEVELS)[number])
        const len = THINKING_LEVELS.length
        const candidate = THINKING_LEVELS[current < 0 ? len - 1 : (current - 1 + len) % len] ?? THINKING_LEVELS[0]
        if (candidate === undefined) throw new Error('No thinking levels configured')
        const next = candidate
        target.switchThinking(next)
        setThinking(next)
      } catch (error) {
        showError(error)
      }
      return
    }
    if (key.ctrl && key.name === 'm') {
      key.preventDefault()
      openModelDialog()
    }
  })

  onMount(() => {
    void openSession(activeId())
    const mcpTimer = setInterval(() => refreshMcp(session()), 15000)
    const watchdogTimer = setInterval(() => {
      const target = session()
      if (!target) return
      const status = target.status
      if (status !== 'submitted' && status !== 'streaming') return
      const snapshot = { status, messages: messages() as never[], error: target.error }
      if (options.watchdog.enableNotificationWhenStale && watchdog.shouldNotifyStale(snapshot)) {
        pushToast('The session is stale', 'warning')
        notifyStale('The session is stale')
      }
      if (options.watchdog.enableContinuePromptWhenStale && watchdog.shouldSendContinue(snapshot)) {
        pushToast('Session stale — sending continue prompt', 'warning')
        void (async () => {
          try {
            const live = session()
            if (!live) return
            if (live.status === 'submitted' || live.status === 'streaming') await live.steer('continue')
            else await live.sendMessage({ parts: [{ type: 'text', text: 'continue' }] })
          } catch (error) {
            showError(error)
          }
        })()
      }
    }, 5000)
    onCleanup(() => {
      clearInterval(mcpTimer)
      clearInterval(watchdogTimer)
      detachQueue?.()
      session()?.close()
    })
  })

  const openSession = async (id?: string) => {
    try {
      const next = await sessionMgr.startSession({
        id,
        onChange: (state) => {
          setMessages([...state.messages])
          const streaming = state.status === 'submitted' || state.status === 'streaming'
          setIsStreaming(streaming)
          if (streaming) watchdog.recordActivity()
          if (streaming || state.status === 'error') setAnswering(false)
          const w = isWaiting(state.messages)
          setWaiting(w)
          if (state.messages.length > 0) markActiveSessionHasMessages()
          const live = session()
          if (live) {
            setTitle(live.title)
            syncQueue(live)
            setTotals({ ...live.totals })
            setUsage(live.usage ? { ...live.usage } : undefined)
            setActiveSessionStats({ ...live.totals }, state.messages.length)
          }
          const current = session()
          refreshGit(current?.config.cwd ?? sessionMgr.currentCwd)
          if (!prevWaiting && w) {
            const last = state.messages[state.messages.length - 1]
            const found = last?.role === 'assistant' ? pendingFlowPart(last.parts as unknown[]) : undefined
            if (found?.tool === 'plan-write') {
              pushToast('Then agent waiting you to verify the plan', 'warning')
              notifyBlocking('Then agent waiting you to verify the plan')
            } else {
              pushToast('The agent is asking you questions', 'warning')
              notifyBlocking('The agent is asking you questions')
            }
          }
          if (prevStreaming && !streaming) {
            watchdog.reset()
            if (state.error) {
              pushToast(`Run gave error: ${state.error.message}`, 'error')
              notifyFailure(state.error.message)
            } else {
              pushToast('Run is complete', 'success')
              notifyCompletion('Run complete')
              if (live) regenerateTitle(live)
            }
            refreshMcp(live)
          } else if (state.error && state.error.message !== prevErrorMessage) {
            pushToast(`Run gave error: ${state.error.message}`, 'error')
            notifyFailure(state.error.message)
          }
          prevStreaming = streaming
          prevWaiting = w
          prevErrorMessage = state.error?.message
        },
      })
      attachSession(next)
    } catch (error) {
      showError(error)
    }
  }

  const refreshTitle = (promptText: string, target: Session) => {
    if (target.title) return
    if (!promptText.trim()) return
    if (titleGenerationPending.has(target.id)) return
    titleGenerationPending.add(target.id)
    generateSessionTitle(promptText)
      .then((generated) => {
        titleGenerationPending.delete(target.id)
        if (!generated) return
        if (target.title) return
        if (session()?.id !== target.id) {
          target.setTitle(generated)
          return
        }
        target.setTitle(generated)
        setTitle(generated)
      })
      .catch(() => {
        titleGenerationPending.delete(target.id)
      })
  }

  const regenerateTitle = (target: Session) => {
    if (!target.title) return
    if (titleGenerationPending.has(target.id)) return
    const promptText = lastUserText(target.messages)
    if (!promptText?.trim()) return
    const assistantReply = lastAssistantText(target.messages)
    if (!assistantReply?.trim()) return
    titleGenerationPending.add(target.id)
    generateSessionTitle(promptText, assistantReply)
      .then((generated) => {
        titleGenerationPending.delete(target.id)
        if (!generated) return
        target.setTitle(generated)
        if (session()?.id === target.id) setTitle(generated)
      })
      .catch(() => {
        titleGenerationPending.delete(target.id)
      })
  }

  const quitApp = async () => {
    const target = session()
    try {
      await target?.flush()
    } catch {}
    try {
      await flushThemeSave()
    } catch {}
    try {
      closePromptHistory()
    } catch {}
    try {
      renderer.destroy()
    } catch {
      process.exit(0)
    }
  }

  const handleCd = async (arg: string, target: Session) => {
    const raw = arg.trim()
    if (!raw) {
      showError(new Error('Usage: /cd <path>'))
      return
    }
    const base = target.config.cwd ?? sessionMgr.currentCwd
    const next = resolve(base, raw)
    const info = await stat(next).catch(() => undefined)
    if (!info?.isDirectory()) {
      showError(new Error(`Not a directory: ${next}`))
      return
    }
    try {
      try {
        await target.flush()
      } catch {}
      const fresh = await sessionMgr.changeDirectory(next)
      if (!fresh) return
      bumpCatalog()
      attachSession(fresh)
    } catch (error) {
      showError(error)
    }
  }

  const handleNewSession = async (target: Session) => {
    try {
      try {
        await target.flush()
      } catch {}
      detachQueue?.()
      await target.close()
      setSession(undefined)
      setMessages([])
      setIsStreaming(false)
      setWaiting(false)
      setAnswering(false)
      setQueued([])
      setQueueDepth(0)
      await openSession(undefined)
    } catch (error) {
      showError(error)
    }
  }

  const handleRemoveQueued = (id: string) => {
    const target = session()
    if (!target) return
    target.removeQueued(id)
    syncQueue(target)
  }

  const dispatchCommand = async (line: string, target: Session, payloadFiles: AttachedFile[] = []) => {
    if (payloadFiles.length > 0) pushToast('Files are ignored for slash commands', 'warning')
    let parsed: ParsedCommandLine | null
    try {
      parsed = parseCommandLine(line.trim(), listCommands())
    } catch (error) {
      showError(error)
      return
    }
    if (!parsed || parsed.kind === 'unknown') {
      showError(new Error(`Unknown command "${line.trim().split(/\s+/)[0]}"`))
      return
    }
    if (parsed.kind === 'skills') {
      const literal = line.trim()
      if (waiting() || answering() || target.status === 'submitted' || target.status === 'streaming') {
        try {
          target.queue(literal)
        } catch (error) {
          showError(error)
          return
        }
        syncQueue(target)
      } else {
        refreshTitle(parsed.prompt || literal, target)
        try {
          await target.sendMessage({ parts: [{ type: 'text', text: literal }] })
        } catch (error) {
          showError(error)
        }
        if (target.error) showError(target.error)
      }
      return
    }
    if (parsed.kind === 'workflow') {
      let prompt: string
      try {
        prompt = await buildCommandPrompt(parsed.command, parsed.args)
      } catch (error) {
        showError(error)
        return
      }
      if (waiting() || answering() || target.status === 'submitted' || target.status === 'streaming') {
        try {
          target.queue(prompt)
        } catch (error) {
          showError(error)
          return
        }
        syncQueue(target)
      } else {
        refreshTitle(parsed.args || parsed.command.name, target)
        try {
          await target.sendMessage({ parts: [{ type: 'text', text: prompt }] })
        } catch (error) {
          showError(error)
        }
        if (target.error) showError(target.error)
      }
      return
    }
    switch (parsed.command.name) {
      case 'q':
        await quitApp()
        break
      case 'compact':
        try {
          await target.compact()
        } catch (error) {
          showError(error)
        }
        break
      case 'models':
        openModelDialog()
        break
      case 'fork': {
        if (target.status === 'submitted' || target.status === 'streaming' || isWaiting(target.messages)) {
          showError(new Error('Cannot fork while a run is in progress'))
          break
        }
        const last = target.messages[target.messages.length - 1]
        if (!last) {
          showError(new Error('Nothing to fork yet'))
          break
        }
        await handleFork(last.id)
        break
      }
      case 'summarize': {
        if (target.status === 'submitted' || target.status === 'streaming') {
          showError(new Error('Cannot summarize while a run is in progress'))
          break
        }
        try {
          const result = await target.summarize()
          showInfo('Summary', result.summary)
        } catch (error) {
          showError(error)
        }
        break
      }
      case 'roles':
        openRolesDialog()
        break
      case 'cd':
        await handleCd(parsed.args, target)
        break
      case 'new':
        await handleNewSession(target)
        break
      case 'reload': {
        if (target.status === 'submitted' || target.status === 'streaming') {
          showError(new Error('Cannot reload while a run is in progress'))
          break
        }
        resetAuthCache()
        resetMcpAuthCache()
        try {
          await target.mcp.reload()
        } catch (error) {
          showError(error)
        }
        bumpCatalog()
        const [skills, workflows, rules, subagents, servers] = await Promise.all([
          Promise.resolve(target.skills).catch(() => []),
          Promise.resolve(target.workflows).catch(() => []),
          Promise.resolve(target.rules).catch(() => []),
          listSubagents(target.config.cwd ?? options.app.cwd).catch(() => []),
          target.mcp.servers().catch(() => []),
        ])
        const connected = servers.filter((s) => s.connected).length
        const tools = servers.reduce((n, s) => n + s.tools.length, 0)
        pushToast(`Reloaded ${skills.length} skills, ${workflows.length} workflows, ${rules.length} rules, ${subagents.length} subagents, MCP ${connected}/${servers.length} (${tools} tools)`, 'info')
        refreshMcp(target)
        break
      }
    }
  }

  const handlePrompt = async (payload: PromptPayload) => {
    const target = session()
    if (!target) {
      showError(new Error('Session is not ready yet, please try again'))
      return
    }
    const text = payload.text
    const message = buildMessage(text, payload.files)
    if (text.startsWith('/')) {
      await dispatchCommand(text, target, payload.files)
      return
    }
    if (mode() === 'steer') {
      refreshTitle(text, target)
      try {
        await target.steer(message)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          syncQueue(target)
          return
        }
        showError(error)
        return
      }
      syncQueue(target)
      return
    }
    if (waiting() || answering()) {
      try {
        target.queue(message)
      } catch (error) {
        showError(error)
        return
      }
      syncQueue(target)
      refreshTitle(text, target)
      return
    }
    if (target.status === 'submitted' || target.status === 'streaming') {
      target.queue(message)
      syncQueue(target)
      refreshTitle(text, target)
      return
    }
    refreshTitle(text, target)
    try {
      await target.sendMessage(message)
    } catch (error) {
      showError(error)
    }
    syncQueue(target)
    if (target.error) showError(target.error)
  }

  const handleFlowResponse = async (response: ToolFlowResponse) => {
    const target = session()
    if (!target) {
      showError(new Error('Session is not ready yet, please try again'))
      return
    }
    setAnswering(true)
    try {
      if (response.tool === 'plan-write' && response.output.status === 'approved') {
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
      showError(new Error('Session is not ready yet, please try again'))
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
      showError(new Error('Session is not ready yet, please try again'))
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
        <SessionHeader
          agentId={agentId()}
          modelKey={modelKey()}
          thinking={thinking()}
          title={title()}
          cwd={cwd()}
          git={git()}
          messages={messages()}
          totals={totals()}
          usage={usage()}
          streaming={isStreaming()}
          queueDepth={queueDepth()}
          mode={mode()}
          waiting={waiting() || answering()}
          mcp={mcp()}
        />
        <SessionMessages
          messages={messages()}
          isStreaming={isStreaming()}
          onFlowResponse={handleFlowResponse}
          onMessageOpen={(message) => openMessageActions({ message, onRevert: handleRevert, onFork: (id) => void handleFork(id) })}
          onOpenSubSession={(id, label) => openSubagentMessages({ manager: sessionMgr, sessionId: id, label })}
        />
        <SessionQueue items={queued()} onRemove={handleRemoveQueued} />
        <SessionPrompt
          onPrompt={handlePrompt}
          streaming={isStreaming()}
          waiting={waiting() || answering()}
          mode={mode()}
          queueDepth={queueDepth()}
          onCommandOpenChange={setCommandOpen}
          commandExitNonce={commandExitNonce()}
          editRequest={editRequest()}
          historyProjectKey={projectKey()}
        />
        <SessionStatus
          agentId={agentId()}
          modelKey={modelKey()}
          thinking={thinking()}
          title={title()}
          cwd={cwd()}
          git={git()}
          messages={messages()}
          totals={totals()}
          usage={usage()}
          streaming={isStreaming()}
          queueDepth={queueDepth()}
          mode={mode()}
          waiting={waiting() || answering()}
          mcp={mcp()}
        />
      </box>
    </box>
  )
}
