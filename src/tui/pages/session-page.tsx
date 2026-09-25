import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildCommandPrompt } from '@agent/commands/discovery.ts'
import { executeBangCommand } from '@agent/commands/execute-bang-command.ts'
import { listCommands } from '@agent/commands/index.ts'
import { type ParsedCommandLine, parseCommandLine } from '@agent/commands/parse-command-line.ts'
import type { LoopMessage, LoopStats } from '@agent/loop/create-loop.ts'
import { generateSessionTitle } from '@agent/prompts/session-title.ts'
import { closePromptHistory, projectKeyFor } from '@agent/sessions/prompt-history.ts'
import type { QueuedPrompt, Session } from '@agent/sessions/session.ts'
import { SessionManager } from '@agent/sessions/session-manager.ts'
import { lastAssistantText, type PromptAttachment } from '@agent/sessions/session-messages.ts'
import { isWaiting } from '@agent/sessions/session-meta.ts'
import { createSessionWatchdog } from '@agent/sessions/session-watchdog.ts'
import { stopAllBackgroundShells } from '@agent/tools/filesystem/background-shell.ts'
import { resetAuthCache } from '@auth/store.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import { options } from '@config/options.ts'
import { resetMcpAuthCache } from '@integrations/mcp/auth.ts'
import { useRenderer } from '@opentui/solid'
import { setConsoleTitle } from '@shared/console-title.ts'
import { getGitInfo } from '@shared/git-info.ts'
import { logError, setLogRunId } from '@shared/logger.ts'
import { notifyBlocking, notifyCompletion, notifyFailure } from '@shared/notify.ts'
import { allocBangId, type BangOutput, bangOutput, clearBangOutput, setBangOutput } from '@states/bang-output.state.ts'
import { bumpCatalog } from '@states/catalog-state.ts'
import { closeDialog, dialogStatus, openDialog } from '@states/dialog.state.ts'
import { flushThemeSave, theme } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { openJobsDialog } from '@tui/components/session/jobs-dialog.tsx'
import { openMessageActions } from '@tui/components/session/message-actions.tsx'
import { ModelSelect } from '@tui/components/session/model-select.tsx'
import { openRolesDialog } from '@tui/components/session/roles-dialog.tsx'
import { SessionBangOutput } from '@tui/components/session/session-bang-output.tsx'
import { SessionHeader } from '@tui/components/session/session-header.tsx'
import { SessionMessages } from '@tui/components/session/session-messages.tsx'
import { type AttachedFile, type EditRequest, type PromptMode, type PromptPayload, SessionPrompt } from '@tui/components/session/session-prompt.tsx'
import { SessionQueue } from '@tui/components/session/session-queue.tsx'
import { SessionStatus, THINKING_LEVELS } from '@tui/components/session/session-status.tsx'
import type { SessionStatusProps } from '@tui/components/session/status/session-status-data.ts'
import { getModelContextSize } from '@tui/components/session/status/status-meta.ts'
import { openStatusLayoutDialog } from '@tui/components/session/status-layout-dialog.tsx'
import { openSubagentMessages } from '@tui/components/session/subagent-dialog.tsx'
import type { ToolFlowResponse } from '@tui/components/session/tools/tool-part.tsx'
import { setExitStatus } from '@tui/hooks/exit-status.ts'
import { useAppKeyboard } from '@tui/hooks/keyboard-provider.tsx'
import { requestAppReload, setLastSessionId } from '@tui/hooks/reload-bus.ts'
import { DOUBLE_PRESS_WINDOW_MS, isCycleEffortKey, isExitKey, isJobsKey, isModelKey, isRepeatKey, isSandboxKey, isSteerKey } from '@tui/keybindings.ts'
import type { CreateUIMessage } from 'ai'
import { batch, createEffect, createSignal, getOwner, onCleanup, onMount, runWithOwner } from 'solid-js'
import { type StatsStatusState, shouldSyncStats, toStatsState } from './session-stats-sync.ts'

export interface SessionPageProps {
  sessionId?: string
  visible: boolean
}

const AGENT_CYCLE = ['ask', 'grill', 'plan-code', 'coder']

const showError = (error: unknown, sessionId?: string) => {
  logError(error, { scope: 'session-page', ...(sessionId ? { sessionId } : {}) })
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

interface LooseFlowPart {
  type?: unknown
  toolName?: unknown
  toolCallId?: unknown
  output?: unknown
}

const pendingFlowPart = (parts: Array<unknown>): { tool: 'ask' | 'plan-write'; toolCallId: string } | undefined => {
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

const flowToolName = (tool: 'ask' | 'plan-write'): string => (tool === 'ask' ? 'ASK' : 'PLAN WRITE')

const lastUserText = (messages: Array<LoopMessage>): string | undefined => {
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
  const [messages, setMessages] = createSignal<Array<LoopMessage>>([])
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [waiting, setWaiting] = createSignal(false)
  const [answering, setAnswering] = createSignal(false)
  const [activeId, setActiveId] = createSignal<string | undefined>(props.sessionId)
  const [agentId, setAgentId] = createSignal<string | undefined>(undefined)
  const [modelKey, setModelKey] = createSignal<string | undefined>(undefined)
  const [thinking, setThinking] = createSignal<ProviderModelReasoningEffort | undefined>(undefined)
  const [title, setTitle] = createSignal<string | undefined>(undefined)
  const [mcp, setMcp] = createSignal<{ connected: number; total: number; tools: number }>({ connected: 0, total: 0, tools: 0 })
  const [cwd, setCwd] = createSignal<string | undefined>(undefined)
  const [git, setGit] = createSignal<{ branch: string; additions: number; deletions: number } | null>(null)
  const [mode, setMode] = createSignal<PromptMode>('normal')
  const [queueDepth, setQueueDepth] = createSignal(0)
  const [queued, setQueued] = createSignal<Array<QueuedPrompt>>([])
  const [editRequest, setEditRequest] = createSignal<EditRequest | undefined>(undefined)
  const [projectKey, setProjectKey] = createSignal<string>(projectKeyFor())
  const [commandOpen, setCommandOpen] = createSignal(false)
  const [commandExitNonce, setCommandExitNonce] = createSignal(0)
  const [statsStatus, setStatsStatus] = createSignal<StatsStatusState | undefined>(undefined)
  const [statsPerformance, setStatsPerformance] = createSignal<LoopStats['performance']>(undefined)
  const [statsMetrics, setStatsMetrics] = createSignal<LoopStats | undefined>(undefined)
  const sessionMgr = new SessionManager()
  const [sandboxOn, setSandboxOn] = createSignal(sessionMgr.sandboxEnabled)
  const [bgJobs, setBgJobs] = createSignal(sessionMgr.runningShellJobCount())
  const renderer = useRenderer()
  const watchdog = createSessionWatchdog({ staleTimeoutMs: options.watchdog.staleTimeoutMs })
  let lastEsc = 0
  let lastCtrlD = 0
  let prevStreaming = false
  let prevWaiting = false
  let prevErrorMessage: string | undefined
  const titleGenerationPending = new Set<string>()

  createEffect(() => {
    setConsoleTitle(options.app.name, activeId(), title())
  })

  let gitRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let gitRefreshPending: string | undefined
  let gitRefreshHasPending = false
  const refreshGit = (dir: string | undefined) => {
    gitRefreshPending = dir
    gitRefreshHasPending = true
    if (gitRefreshTimer !== undefined) return
    gitRefreshTimer = setTimeout(() => {
      gitRefreshTimer = undefined
      if (!gitRefreshHasPending) return
      gitRefreshHasPending = false
      const nextCwd = gitRefreshPending
      const nextGit = nextCwd ? getGitInfo(nextCwd) : null
      batch(() => {
        setCwd(nextCwd)
        setGit(nextGit)
      })
    }, 250)
  }
  onCleanup(() => {
    if (gitRefreshTimer !== undefined) clearTimeout(gitRefreshTimer)
  })

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
  let detachStats: (() => void) | undefined
  let editNonce = 0
  const pageOwner = getOwner()
  let statsBuffer: LoopStats | undefined
  let statsBufferOwner: string | undefined
  let statsTimer: ReturnType<typeof setTimeout> | undefined
  let statsWindowOpen = false

  const resetStatsThrottle = () => {
    statsBuffer = undefined
    statsBufferOwner = undefined
    statsWindowOpen = false
    if (statsTimer) {
      clearTimeout(statsTimer)
      statsTimer = undefined
    }
  }

  const flushStatsBuffer = () => {
    statsTimer = undefined
    statsWindowOpen = false
    const snapshot = statsBuffer
    const ownerId = statsBufferOwner
    statsBuffer = undefined
    statsBufferOwner = undefined
    if (snapshot !== undefined) runWithOwner(pageOwner, () => syncStats(snapshot, ownerId))
  }

  const bufferStats = (stats: LoopStats, ownerId: string | undefined) => {
    statsBuffer = stats
    statsBufferOwner = ownerId
    if (statsWindowOpen) return
    statsWindowOpen = true
    runWithOwner(pageOwner, () => syncStats(stats, ownerId))
    statsTimer = setTimeout(() => flushStatsBuffer(), 200)
  }

  const resetStats = () => {
    resetStatsThrottle()
    batch(() => {
      setStatsStatus(undefined)
      setStatsPerformance(undefined)
      setStatsMetrics(undefined)
    })
  }

  const syncStats = (stats: LoopStats | undefined, ownerId?: string) => {
    if (!shouldSyncStats(ownerId, session()?.id, activeId())) return
    const next = toStatsState(stats)

    batch(() => {
      setStatsStatus(next.status)
      setStatsPerformance(next.performance)
      setStatsMetrics(next.metrics)
    })
  }

  const bytesFromDataUrl = (url: string): Uint8Array => {
    const match = /^data:[^;]+;base64,(.*)$/s.exec(url)
    if (!match) return new TextEncoder().encode(url)
    try {
      return Uint8Array.from(Buffer.from(match[1] ?? '', 'base64'))
    } catch {
      return new TextEncoder().encode(url)
    }
  }

  const attachedFromPrompt = (key: string, text: string, files: Array<PromptAttachment>): Array<AttachedFile> => {
    const seqs: Array<number> = []
    for (const match of text.matchAll(/\[(\d+) ([^\s\]]+) ([^\]]+)\]/g)) seqs.push(Number(match[1]))
    return files.map((f, index) => {
      const bytes = bytesFromDataUrl(f.url)
      return { id: `q-${key}-${index}`, seq: seqs[index] ?? -(index + 1), mediaType: f.mediaType, filename: f.filename ?? `queued-${index + 1}`, size: bytes.byteLength, bytes }
    })
  }

  const attachedFromQueued = (item: QueuedPrompt): Array<AttachedFile> => attachedFromPrompt(item.id, item.text, item.files)

  const buildMessage = (text: string, files: Array<AttachedFile>): CreateUIMessage<LoopMessage> =>
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
    const nextQueued = [...target.queued]
    const nextDepth = target.queuedCount
    batch(() => {
      setQueued(nextQueued)
      setQueueDepth(nextDepth)
    })
  }

  const attachSession = (next: Session) => {
    detachQueue?.()
    detachStats?.()
    setLastSessionId(next.id)
    try {
      setLogRunId(next.id)
    } catch {}
    const streaming = next.status === 'submitted' || next.status === 'streaming'
    const w = isWaiting(next.messages)
    const nextProjectKey = projectKeyFor(next.config.cwd ?? sessionMgr.currentCwd)
    const nextMessages = [...next.messages]
    const nextQueued = [...next.queued]
    const nextDepth = next.queuedCount
    batch(() => {
      setSession(next)
      setActiveId(next.id)
      setAgentId(next.config.agentId)
      setModelKey(next.config.modelKey)
      setThinking(next.config.thinking)
      setTitle(next.title)
      setMessages(nextMessages)
      setQueued(nextQueued)
      setQueueDepth(nextDepth)
      setProjectKey(nextProjectKey)
      setIsStreaming(streaming)
      setWaiting(w)
    })
    detachQueue = next.onQueueChange((items) => {
      const changedQueued = [...items]
      const changedDepth = items.length
      batch(() => {
        setQueued(changedQueued)
        setQueueDepth(changedDepth)
      })
    })
    resetStatsThrottle()
    syncStats(next.stats, next.id)
    detachStats = next.onStatsChange((stats) => bufferStats(stats, next.id))
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

  const statusProps = (): SessionStatusProps => ({
    agentId: agentId(),
    modelKey: modelKey(),
    thinking: thinking(),
    title: title(),
    cwd: cwd(),
    git: git(),
    messages: messages(),
    streaming: isStreaming(),
    queueDepth: queueDepth(),
    mode: mode(),
    waiting: waiting() || answering(),
    mcp: mcp(),
    sandbox: sandboxOn(),
    bgJobs: bgJobs(),
    provider: modelKey() ? { id: modelKey()?.split('/')[0] ?? '' } : undefined,
    statsStatus: statsStatus(),
    statsPerformance: statsPerformance(),
    statsMetrics: statsMetrics(),
  })

  const cancelPendingFlow = async () => {
    const msgs = messages()
    const last = msgs[msgs.length - 1]
    if (last?.role !== 'assistant') return
    const found = pendingFlowPart(last.parts as Array<unknown>)
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

  useAppKeyboard((key) => {
    if (isRepeatKey(key)) return
    if (dialogStatus().status === 'open') return
    const target = session()
    if (!target) return

    if (key.name === 'escape') {
      if (commandOpen()) {
        setCommandExitNonce((n) => n + 1)
        lastEsc = 0
        return
      }
      if (bangOutput()) {
        clearBangOutput()
        lastEsc = 0
        return
      }
      const now = Date.now()
      if (now - lastEsc < DOUBLE_PRESS_WINDOW_MS) {
        lastEsc = 0
        key.preventDefault()
        void interruptStack()
      } else {
        lastEsc = now
        pushToast('Press ESC again to stop the run', 'warning')
      }
      return
    }
    if (isSteerKey(key)) {
      key.preventDefault()
      setMode((m) => (m === 'steer' ? 'normal' : 'steer'))
      return
    }
    if (isExitKey(key)) {
      key.preventDefault()
      const now = Date.now()
      if (now - lastCtrlD < DOUBLE_PRESS_WINDOW_MS) {
        lastCtrlD = 0
        void quitApp()
      } else {
        lastCtrlD = now
        pushToast('Press ⌃D (or F10) again to exit!', 'warning')
      }
      return
    }
    if (isJobsKey(key)) {
      key.preventDefault()
      key.stopPropagation()
      openJobsDialog({
        manager: sessionMgr,
        onOpenSession: (id, label) => openSubagentMessages({ manager: sessionMgr, sessionId: id, label }),
      })
      return
    }
    if (key.name === 'tab' && key.shift) {
      if (commandOpen()) return
      key.preventDefault()
      try {
        const current = AGENT_CYCLE.indexOf(agentId() ?? target.config.agentId)
        const candidate = AGENT_CYCLE[(current + 1) % AGENT_CYCLE.length] ?? AGENT_CYCLE[0]
        if (candidate === undefined) throw new Error('No agents configured')
        const next = candidate
        const previous = agentId() ?? target.config.agentId
        const previousModel = modelKey() ?? target.config.modelKey
        target.switchAgent(next)
        setAgentId(next)
        batch(() => {
          setModelKey(target.config.modelKey)
          setThinking(target.config.thinking)
        })
        if (previous !== next) pushToast(`Agent changed from ${previous} to ${next}`, 'info')
        if (previousModel !== target.config.modelKey) pushToast(`Model switched to ${target.config.modelKey} (agent ${next})`, 'info')
      } catch (error) {
        showError(error)
      }
      return
    }
    if (isCycleEffortKey(key)) {
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
    if (isSandboxKey(key)) {
      key.preventDefault()
      key.stopPropagation()
      const next = !sessionMgr.sandboxEnabled
      sessionMgr.setSandbox(next)
      setSandboxOn(next)
      pushToast(next ? 'Sandbox enabled — takes effect on next run' : 'Sandbox disabled — takes effect on next run', next ? 'success' : 'warning')
      return
    }
    if (isModelKey(key)) {
      key.preventDefault()
      key.stopPropagation()
      openModelDialog()
    }
  })

  onMount(() => {
    void openSession(activeId())
    const detachShellJobs = sessionMgr.onShellJobs((entries) => setBgJobs(entries.filter((entry) => entry.status === 'running').length))
    const mcpTimer = setInterval(() => refreshMcp(session()), 15000)
    const watchdogTimer = setInterval(() => {
      const target = session()
      if (!target) return
      const status = target.status
      if (status !== 'submitted' && status !== 'streaming') return
      const snapshot = { status, messages: messages() as Array<never>, error: target.error }
      if (options.watchdog.enableNotificationWhenStale && watchdog.shouldNotifyStale(snapshot)) {
        pushToast('The session is stale', 'warning')
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
      detachShellJobs()
      detachQueue?.()
      detachStats?.()
      resetStatsThrottle()
      const closing = session()
      if (closing) void sessionMgr.evictSession(closing.id)
    })
  })

  const openSession = async (id?: string) => {
    try {
      const next = await sessionMgr.startSession({
        id,
        onChange: (state) => {
          const nextMessages = [...state.messages]
          const streaming = state.status === 'submitted' || state.status === 'streaming'
          const shouldClearAnswering = streaming || state.status === 'error'
          const w = isWaiting(state.messages)
          batch(() => {
            setMessages(nextMessages)
            setIsStreaming(streaming)
            if (shouldClearAnswering) setAnswering(false)
            setWaiting(w)
          })
          if (streaming) watchdog.recordActivity()
          const live = session()
          if (live) {
            const nextAgentId = live.config.agentId !== agentId() ? live.config.agentId : undefined
            batch(() => {
              setTitle(live.title)
              if (nextAgentId !== undefined) setAgentId(nextAgentId)
            })
            syncQueue(live)
            if (nextAgentId !== undefined) pushToast(`Agent switched to ${live.config.agentId}`, 'info')
          }
          const current = session()
          refreshGit(current?.config.cwd ?? sessionMgr.currentCwd)
          if (!prevWaiting && w) {
            const last = state.messages[state.messages.length - 1]
            const found = last?.role === 'assistant' ? pendingFlowPart(last.parts as Array<unknown>) : undefined
            if (found) {
              const waitingMessage = `${flowToolName(found.tool)} - Waiting User Action`
              pushToast(waitingMessage, 'warning')
              notifyBlocking(flowToolName(found.tool))
            } else {
              pushToast('The agent is asking you questions', 'warning')
              notifyBlocking('Agent')
            }
          }
          if (prevStreaming && !streaming) {
            watchdog.reset()
            if (state.error) {
              pushToast(`Run did throw an Error: ${state.error.message}`, 'error')
              notifyFailure(`Run did throw an Error: ${state.error.message}`)
            } else {
              pushToast('Run is complete', 'success')
              const lastRole = state.messages[state.messages.length - 1]?.role
              if (lastRole === 'assistant') notifyCompletion(live?.title ? `${live.title} — run complete` : 'Run complete')
              if (live) regenerateTitle(live)
            }
            refreshMcp(live)
          } else if (state.error && state.error.message !== prevErrorMessage) {
            pushToast(`Run did throw an Error: ${state.error.message}`, 'error')
            notifyFailure(`Run did throw an Error: ${state.error.message}`)
          }
          prevStreaming = streaming
          prevWaiting = w
          prevErrorMessage = state.error?.message
          const statsSource = session()?.id === next.id ? session() : next
          if (streaming) {
            if (statsSource?.stats) bufferStats(statsSource.stats, next.id)
          } else {
            resetStatsThrottle()
            syncStats(statsSource?.stats, next.id)
          }
        },
      })
      attachSession(next)
    } catch (error) {
      logError(error, { scope: 'open-session', ...(id ? { sessionId: id } : {}) })
      showError(error, id)
    }
  }

  const refreshTitle = (promptText: string, target: Session) => {
    if (target.title) return
    if (!promptText.trim()) return
    if (titleGenerationPending.has(target.id)) return
    titleGenerationPending.add(target.id)
    generateSessionTitle(promptText, undefined, { sessionId: target.id })
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
    generateSessionTitle(promptText, assistantReply, { sessionId: target.id })
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
    await stopAllBackgroundShells().catch(() => {})
    setExitStatus(
      target
        ? {
            sessionId: target.id,
            messageCount: target.messages.length,
            inputTokens: target.stats?.usage?.inputTokenDetails.noCacheTokens,
            outputTokens: target.stats?.usage.outputTokens,
            contextUsage: target.stats?.usage.totalTokens,
            contextSize: getModelContextSize(modelKey()),
            cost: target.stats?.cost.total,
          }
        : undefined,
    )
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
      detachQueue?.()
      await sessionMgr.evictSession(target.id)
      batch(() => {
        setSession(undefined)
        setMessages([])
        setIsStreaming(false)
        setWaiting(false)
        setAnswering(false)
        setQueued([])
        setQueueDepth(0)
      })
      resetStats()
      const fresh = await sessionMgr.changeDirectory(next)
      if (!fresh) return
      bumpCatalog()
      attachSession(fresh)
    } catch (error) {
      showError(error)
    }
  }

  const handleNewSession = async (target: Session) => {
    if (target.status === 'submitted' || target.status === 'streaming' || isWaiting(target.messages) || answering()) {
      showError(new Error('Cannot start a new session while a run is in progress'))
      return
    }
    try {
      try {
        await target.flush()
      } catch {}
      detachQueue?.()
      await sessionMgr.evictSession(target.id)
      batch(() => {
        setSession(undefined)
        setMessages([])
        setIsStreaming(false)
        setWaiting(false)
        setAnswering(false)
        setQueued([])
        setQueueDepth(0)
      })
      resetStats()
      await openSession(undefined)
    } catch (error) {
      showError(error)
    }
  }

  const handleRemoveQueued = (id: string) => {
    const target = session()
    if (!target) return
    const removed = target.queued.find((item) => item.id === id)
    target.removeQueued(id)
    syncQueue(target)
    if (removed && (removed.text.trim().length > 0 || removed.files.length > 0)) {
      editNonce += 1
      setEditRequest({ text: removed.text, files: attachedFromQueued(removed), nonce: editNonce })
      pushToast('Queued prompt moved back to the prompt for editing', 'info')
    }
  }

  const handleBang = async (line: string, target: Session, files: Array<AttachedFile>) => {
    const body = line.slice(1).trim()
    if (body.length === 0) {
      showError(new Error('Usage: !<command>'))
      return
    }
    if (files.length > 0) pushToast('Files are ignored for shell commands', 'warning')
    const cwd = target.config.cwd ?? sessionMgr.currentCwd ?? options.app.cwd
    pushToast(`$ ${body}`, 'info')
    try {
      const result = await executeBangCommand(body, cwd)
      const item: BangOutput = {
        id: allocBangId(),
        command: line,
        cwd,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        outputPath: result.outputPath,
        durationMs: result.durationMs,
        startedAt: Date.now() - result.durationMs,
      }
      setBangOutput(item)
    } catch (error) {
      showError(error)
    }
  }

  const dispatchCommand = async (line: string, target: Session, payloadFiles: Array<AttachedFile> = []) => {
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
      case 'compact': {
        if (target.status === 'submitted' || target.status === 'streaming' || isWaiting(target.messages)) {
          showError(new Error('Cannot compact while a run is in progress'))
          break
        }
        try {
          const result = await target.compact({ force: true })
          if (result.compacted) pushToast(`Compacted ${result.summarizedCount ?? 0} messages into a summary`, 'info')
          else pushToast('Nothing to compact yet', 'info')
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
        try {
          await target.flush()
        } catch {}
        resetAuthCache()
        resetMcpAuthCache()
        try {
          await requestAppReload()
        } catch (error) {
          showError(error)
          break
        }
        pushToast('Reloaded providers, tokens and catalog', 'info')
        break
      }
      case 'export': {
        if (target.status === 'submitted' || target.status === 'streaming') {
          showError(new Error('Cannot export while a run is in progress'))
          break
        }
        try {
          const { exportSessionHtml } = await import('@agent/sessions/session-export.ts')
          const out = await exportSessionHtml({ sessionId: target.id, cwd: target.config.cwd, messages: target.messages as never, stats: target.stats, out: parsed.args.trim() || undefined })
          showInfo('Exported', out)
        } catch (error) {
          showError(error)
        }
        break
      }
      case 'session-status-view':
        openStatusLayoutDialog({ surface: 'status', getStatusProps: statusProps, onModelOpen: openModelDialog })
        break
      case 'session-header-view':
        openStatusLayoutDialog({ surface: 'header', getStatusProps: statusProps })
        break
    }
  }

  const handlePrompt = async (payload: PromptPayload) => {
    clearBangOutput()
    const target = session()
    if (!target) {
      showError(new Error('Session is not ready yet, please try again'))
      return
    }
    const text = payload.text
    const message = buildMessage(text, payload.files)
    if (text.startsWith('!')) {
      await handleBang(text, target, payload.files)
      return
    }
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
      const result = target.revertToMessage(messageId)
      if (result.prompt) {
        const { text, files } = result.prompt
        editNonce += 1
        setEditRequest({ text, files: attachedFromPrompt(messageId, text, files), nonce: editNonce })
      }
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
    if (target.status === 'submitted' || target.status === 'streaming' || isWaiting(target.messages) || answering()) {
      showError(new Error('Cannot fork while a run is in progress'))
      return
    }
    try {
      const { sessionId: forkId } = await sessionMgr.forkSession(target.id, { upToMessageId: messageId })
      closeDialog()
      await sessionMgr.evictSession(target.id)
      batch(() => {
        setSession(undefined)
        setMessages([])
        setIsStreaming(false)
        setWaiting(false)
        setAnswering(false)
      })
      resetStats()
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
          streaming={isStreaming()}
          queueDepth={queueDepth()}
          mode={mode()}
          waiting={waiting() || answering()}
          mcp={mcp()}
          statsStatus={statsStatus()}
          statsPerformance={statsPerformance()}
          statsMetrics={statsMetrics()}
        />
        <SessionMessages
          messages={messages()}
          isStreaming={isStreaming()}
          onFlowResponse={handleFlowResponse}
          onMessageOpen={(message, part) => openMessageActions({ message, part, onRevert: handleRevert, onFork: (id) => void handleFork(id) })}
          onOpenSubSession={(id, label) => openSubagentMessages({ manager: sessionMgr, sessionId: id, label })}
          manager={sessionMgr}
        />
        <SessionQueue items={queued()} onRemove={handleRemoveQueued} />
        <SessionBangOutput />
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
          firstRun={messages().length === 0}
        />
        <SessionStatus
          agentId={agentId()}
          modelKey={modelKey()}
          thinking={thinking()}
          title={title()}
          cwd={cwd()}
          git={git()}
          messages={messages()}
          streaming={isStreaming()}
          queueDepth={queueDepth()}
          mode={mode()}
          waiting={waiting() || answering()}
          mcp={mcp()}
          sandbox={sandboxOn()}
          bgJobs={bgJobs()}
          provider={modelKey() ? { id: modelKey()?.split('/')[0] ?? '' } : undefined}
          statsStatus={statsStatus()}
          statsPerformance={statsPerformance()}
          statsMetrics={statsMetrics()}
          onModelOpen={openModelDialog}
        />
      </box>
    </box>
  )
}
