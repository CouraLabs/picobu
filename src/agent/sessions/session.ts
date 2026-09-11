import { randomUUID } from 'node:crypto'
import { AGENTS, listAgents } from '@agent/agents/registry.ts'
import { type Command, listCommands, listSkills } from '@agent/commands/index.ts'
import { createLoop, type LoopConfig, type LoopMessage, type LoopMessageMetadata } from '@agent/loop/create-loop.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import { type SummarizeResult, summarizeSession } from '@agent/prompts/summarizer.ts'
import { listRules, type Rule } from '@agent/rules/rules.ts'
import { CheckpointStore, checkpointsPath, type UndoResult } from '@agent/sessions/checkpoints.ts'
import { buildPlanHandoffCut, type CompactResult, compactedMessageText, compactSession, isCompactionCut, messagesForLlm } from '@agent/sessions/session-compaction.ts'
import { Chat, type ChatChangeHandler, createHeadlessChatState } from '@agent/sessions/session-headless-chat.ts'
import { dropUnansweredPrompt, settleAbortedToolParts, stripAnalysedImages, stripUnreplayableReasoning } from '@agent/sessions/session-messages.ts'
import { isWaiting, readSessionMeta, type SessionMeta, type SessionState, updateSessionMeta, writeSessionMeta } from '@agent/sessions/session-meta.ts'
import { folderKeyFor, generateSessionId, sessionFilePath } from '@agent/sessions/session-paths.ts'
import { loadSession, SessionSaver } from '@agent/sessions/session-store.ts'
import { options, type ProviderModelReasoningEffort } from '@config/options.ts'
import type { ChatState } from 'ai'
import { type AsyncIterableStream, type ChatInit, type ChatStatus, type ChatTransport, type CreateUIMessage, generateId, readUIMessageStream, type UIMessageChunk } from 'ai'

export type SessionUsage = {
  finishReason?: string
}

export type SessionPrompt = string | CreateUIMessage<LoopMessage>
export type QueuedFile = {
  mediaType: string
  filename?: string
  url: string
}
export type QueuedPrompt = {
  id: string
  text: string
  queuedAt: number
  steered: boolean
  files: QueuedFile[]
}
type PendingPrompt = {
  id: string
  queuedAt: number
  steered: boolean
  message: CreateUIMessage<LoopMessage>
  resolve?: () => void
  reject?: (error: Error) => void
}

export type FlowToolName = 'ask' | 'plan-write'
export type FlowToolOutput = { status: string; message: string }
export type RespondFlowToolInput = {
  tool: FlowToolName
  toolCallId: string
  output: FlowToolOutput
}

type LooseFlowPart = {
  type?: unknown
  toolName?: unknown
  toolCallId?: unknown
  state?: unknown
  input?: unknown
  output?: unknown
}

const flowToolPartName = (part: LooseFlowPart): string | undefined => {
  if (part.type === 'dynamic-tool') return typeof part.toolName === 'string' ? part.toolName : undefined
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) return part.type.slice('tool-'.length)
  return undefined
}

const findFlowPart = (messages: LoopMessage[], tool: string, toolCallId: string): { message: LoopMessage; part: LooseFlowPart } | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    for (const raw of message.parts ?? []) {
      const part = raw as LooseFlowPart
      if (flowToolPartName(part) !== tool) continue
      if (part.toolCallId !== toolCallId) continue
      return { message, part }
    }
  }
  return undefined
}

const flowOutputStatus = (part: LooseFlowPart): string | undefined => {
  const output = part.output as { status?: unknown } | undefined
  return typeof output?.status === 'string' ? output.status : undefined
}

export const toPromptMessage = (prompt: SessionPrompt): CreateUIMessage<LoopMessage> =>
  typeof prompt === 'string' ? ({ parts: [{ type: 'text', text: prompt }] } as CreateUIMessage<LoopMessage>) : prompt

export const queuedTextFromMessage = (message: CreateUIMessage<LoopMessage>): string =>
  (message.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => (p as { type?: unknown }).type === 'text')
    .map((p) => p.text)
    .join('\n')

export const queuedFilesFromMessage = (message: CreateUIMessage<LoopMessage>): QueuedFile[] => {
  const out: QueuedFile[] = []
  for (const raw of message.parts ?? []) {
    const part = raw as { type?: unknown; mediaType?: unknown; filename?: unknown; url?: unknown }
    if (part.type !== 'file') continue
    if (typeof part.mediaType !== 'string' || typeof part.url !== 'string') continue
    out.push({
      mediaType: part.mediaType,
      ...(typeof part.filename === 'string' ? { filename: part.filename } : {}),
      url: part.url,
    })
  }
  return out
}

export type Session = {
  readonly id: string
  readonly status: ChatStatus
  readonly error: Error | undefined
  readonly messages: LoopMessage[]
  readonly lastMessage: LoopMessage | undefined
  readonly config: LoopConfig
  readonly title: string | undefined
  readonly skills: Command[]
  readonly workflows: Command[]
  readonly rules: Rule[]
  readonly agents: ReturnType<typeof listAgents>
  readonly mcp: {
    servers: () => Promise<import('@integrations/mcp/client.ts').McpServerSnapshot[]>
    tools: () => Promise<string[]>
    refresh: () => Promise<void>
    reload: () => Promise<void>
  }
  readonly usage: SessionUsage | undefined
  readonly state: SessionState
  summarize: () => Promise<SummarizeResult>
  setTitle: (title: string) => void
  undo: () => Promise<UndoResult>
  redo: () => Promise<UndoResult>
  revertToMessage: (messageId: string) => void
  sendMessage: Chat['sendMessage']
  regenerate: Chat['regenerate']
  stop: Chat['stop']
  abort: () => void
  clearError: Chat['clearError']
  addToolOutput: Chat['addToolOutput']
  respondFlowTool: (input: RespondFlowToolInput) => Promise<void>
  setPlanHandoffCompact: (compact: boolean) => void
  switchAgent: (agentId: string) => void
  switchModel: (modelKey: string) => void
  switchThinking: (thinking: ProviderModelReasoningEffort) => void
  queue: (prompt: SessionPrompt) => void
  readonly queued: QueuedPrompt[]
  readonly queuedCount: number
  removeQueued: (id: string) => boolean
  onQueueChange: (listener: (items: QueuedPrompt[]) => void) => () => void
  dequeueNewest: () => QueuedPrompt | undefined
  stream: () => AsyncGenerator<UIMessageChunk>
  streamMessages: () => AsyncIterableStream<LoopMessage>
  steer: (prompt: SessionPrompt) => Promise<void>
  compact: (opts?: { fork?: boolean }) => Promise<CompactResult>
  uncompact: () => void
  flush: () => Promise<void>
  close: () => Promise<void>
}

export type CreateSessionInit = Omit<ChatInit<LoopMessage>, 'transport'> & {
  config: LoopConfig | (() => LoopConfig)
  onChange?: ChatChangeHandler
  meta?: {
    cwd?: string
    parentSessionId?: string
    title?: string
    forkHost?: () => Promise<string>
  }
  autoCompact?: boolean
  forkOnCompact?: boolean
}

const deriveState = (chat: { status: ChatStatus; error: Error | undefined; messages: LoopMessage[] }): SessionState =>
  chat.status === 'submitted' || chat.status === 'streaming' ? 'running' : chat.error ? 'error' : isWaiting(chat.messages) ? 'waiting' : 'finished'

export async function createSession(init: CreateSessionInit): Promise<Session> {
  const { config: configInit, onChange, messages, onFinish, id: sessionId, meta: metaInit, autoCompact: _autoCompact, forkOnCompact: _forkOnCompact, ...chatInit } = init
  const forkHost = metaInit?.forkHost
  const getConfig = typeof configInit === 'function' ? configInit : () => configInit
  const id = sessionId ?? generateSessionId()
  const cwd = metaInit?.cwd ?? getConfig().cwd ?? options.app.cwd
  const folderKey = folderKeyFor(cwd)
  const initialMessages = messages ?? (sessionId ? ((await loadSession(folderKey, id)) as LoopMessage[]) : undefined)
  const overrides: Partial<LoopConfig> = {}
  const effectiveConfig = (): LoopConfig => ({ ...getConfig(), ...overrides, sessionId: id })
  const loop = createLoop(effectiveConfig)
  const saver = new SessionSaver(sessionFilePath(folderKey, id))

  let meta: SessionMeta | null = await readSessionMeta(folderKey, id)
  if (!meta) {
    meta = {
      id,
      title: metaInit?.title,
      state: 'finished',
      parentSessionId: metaInit?.parentSessionId,
      cwd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelKey: effectiveConfig().modelKey,
    }
    await writeSessionMeta(folderKey, id, meta)
  }
  const persistMeta = (patch: Partial<Omit<SessionMeta, 'id'>>): void => {
    void updateSessionMeta(folderKey, id, patch).catch((error) => {
      console.error('picobu: session meta persist failed:', error)
    })
  }
  let title: string | undefined = meta.title
  let lastUsage: SessionUsage | undefined

  const streamListeners = new Set<(chunk: UIMessageChunk) => void>()
  const runEndListeners = new Set<() => void>()
  const transport: ChatTransport<LoopMessage> = {
    sendMessages: async (options) => {
      const upstream = await loop.transport.sendMessages({
        ...options,
        messages: stripUnreplayableReasoning(messagesForLlm(options.messages)),
      })
      return upstream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            for (const listener of streamListeners) listener(chunk)
            controller.enqueue(chunk)
          },
        }),
      )
    },
    reconnectToStream: (options) => loop.transport.reconnectToStream(options),
  }

  const pendingPrompts: PendingPrompt[] = []
  const queueListeners = new Set<(items: QueuedPrompt[]) => void>()
  const snapshotQueued = (): QueuedPrompt[] =>
    pendingPrompts.map((item) => ({
      id: item.id,
      text: queuedTextFromMessage(item.message),
      queuedAt: item.queuedAt,
      steered: item.steered,
      files: queuedFilesFromMessage(item.message),
    }))
  const emitQueue = (): void => {
    const snapshot = snapshotQueued()
    for (const listener of queueListeners) listener(snapshot)
  }
  let draining = false
  let compaction: Promise<void> | undefined
  let resumeOnce = false
  let planHandoffOnce = false
  let resuming = false
  let planHandoffCompact = false
  const consumedPlanExits = new Set<string>()
  const isRunning = (): boolean => chat.status === 'submitted' || chat.status === 'streaming'
  const abortFailure = (): Error => {
    const failure = new Error('Aborted')
    failure.name = 'AbortError'
    return failure
  }
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      while (pendingPrompts.length > 0 && !isRunning()) {
        if (isWaiting(chat.messages)) break
        const pendingCompaction = compaction
        if (pendingCompaction) await pendingCompaction
        if (isRunning()) break
        if (isWaiting(chat.messages)) break
        const item = pendingPrompts.shift()
        if (!item) break
        emitQueue()
        try {
          await chat.sendMessage(item.message)
          item.resolve?.()
        } catch (error) {
          item.reject?.(error instanceof Error ? error : new Error(String(error)))
        }
      }
    } finally {
      draining = false
    }
  }

  const settlePending = (): void => {
    const pending = pendingPrompts.splice(0)
    const failure = abortFailure()
    for (const item of pending) item.reject?.(failure)
    if (pending.length > 0) emitQueue()
  }
  const markAborting = (): void => {
    if (isRunning()) aborting = true
  }
  const requestStop = (): void => {
    markAborting()
    void chat.stop()
  }
  const assertNotRunning = (what: string): void => {
    if (isRunning()) throw new Error(`Cannot ${what} while a run is in progress`)
  }
  const assertEditable = (op: 'undo' | 'redo'): void => {
    assertNotRunning(op)
    if (chat.error) throw new Error(`Cannot ${op} while the session is in the error state`)
  }

  const latestUsageMeta = (msgs: LoopMessage[]): LoopMessageMetadata | undefined => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const meta = msgs[i]?.metadata as LoopMessageMetadata | undefined
      if (meta?.finishReason) return meta
    }
    return undefined
  }
  let aborting = false
  let lastDerivedState: SessionState | undefined
  const handleStateChange = (state: ChatState<LoopMessage>): void => {
    if (state.status === 'submitted') {
      lastUsage = undefined
    }
    if (state.status === 'streaming') {
      const liveMeta = latestUsageMeta(chat.messages)
      lastUsage = {
        finishReason: liveMeta?.finishReason,
      }
    }
    if (resuming && state.status !== 'ready') resuming = false
    const derived = deriveState(chat)
    if (derived !== lastDerivedState) {
      lastDerivedState = derived
      persistMeta({ state: derived })
    }
    onChange?.(state)
    saver.save(state.messages).catch((error) => {
      console.error('picobu: session save failed:', error)
    })
  }
  const chatState = createHeadlessChatState(initialMessages ?? [], handleStateChange)
  const chat = new Chat({
    ...chatInit,
    sendAutomaticallyWhen: () => {
      if (resumeOnce) {
        resumeOnce = false
        return true
      }
      if (planHandoffOnce) {
        planHandoffOnce = false
        return true
      }
      return false
    },
    id,
    transport,
    state: chatState,
    onFinish: (options) => {
      const wasAborting = aborting
      if (aborting) {
        aborting = false
        const kept = dropUnansweredPrompt(chat.messages)
        if (kept.length !== chat.messages.length) chat.messages = kept
        chat.messages = settleAbortedToolParts(chat.messages)
      }
      const finished = options.message as LoopMessage
      const freshExits = (finished.parts ?? [])
        .map((p) => p as LooseFlowPart)
        .filter((p) => flowToolPartName(p) === 'plan-exit' && p.state === 'output-available')
        .map((p) => (typeof p.toolCallId === 'string' ? p.toolCallId : undefined))
        .filter((id): id is string => !!id && !consumedPlanExits.has(id))
      for (const id of freshExits) consumedPlanExits.add(id)
      if (freshExits.length > 0) {
        overrides.agentId = 'coder'
        resuming = true
        if (planHandoffCompact) {
          const planPart = (finished.parts ?? []).map((p) => p as LooseFlowPart).find((p) => flowToolPartName(p) === 'plan-write' && flowOutputStatus(p) === 'approved')
          const planInput = planPart?.input as { plan?: unknown } | undefined
          const planText = typeof planInput?.plan === 'string' ? planInput.plan : undefined
          const planOutput = planPart?.output as { message?: unknown } | undefined
          const planMessage = planOutput?.message
          const verdictText = typeof planMessage === 'string' ? String(planMessage) : ''
          if (planText) {
            const cut = buildPlanHandoffCut({ messages: chat.messages, plan: planText, verdict: verdictText })
            chat.messages = [
              ...chat.messages,
              {
                id: randomUUID(),
                role: 'user',
                metadata: {
                  compaction: {
                    summary: cut.summary,
                    compactedMessageIds: cut.compactedMessageIds,
                    createdAt: Date.now(),
                    kind: 'plan-handoff',
                  },
                },
                parts: [{ type: 'text', text: cut.text }],
              } as LoopMessage,
            ]
          }
        }
        planHandoffCompact = false
        planHandoffOnce = true
      }
      const meta = options.message.metadata as LoopMessageMetadata | undefined
      lastUsage = {
        finishReason: meta?.finishReason,
      }
      if (!wasAborting && !chat.error && !isWaiting(chat.messages)) {
        const stripped = stripAnalysedImages(chat.messages)
        if (stripped !== chat.messages) chat.messages = stripped
      }
      handleStateChange(chatState)
      onFinish?.(options)
      for (const listener of runEndListeners) listener()
      void drain()
    },
    loop,
  })

  let compacting = false
  const compactInternal = async ({ fork }: { fork?: boolean } = {}): Promise<CompactResult> => {
    if (compacting) throw new Error('Compaction already in progress')
    assertNotRunning('compact')
    if (isWaiting(chat.messages)) {
      throw new Error('Cannot compact while waiting on a flow tool')
    }
    const config = effectiveConfig()
    if (fork && !forkHost) throw new Error('Forking requires a session manager')
    compacting = true
    const run = (async () => {
      try {
        const { summary } = await compactSession({
          messages: chat.messages,
          modelKey: config.modelKey,
          thinking: config.thinking,
        })
        assertNotRunning('compact')
        const forkedSessionId = fork ? await forkHost?.() : undefined
        assertNotRunning('compact')
        const text = compactedMessageText(summary)
        if (fork) {
          const compactedMessageIds = chat.messages.map((message) => message.id)
          const reset: LoopMessage = {
            id: randomUUID(),
            role: 'user',
            metadata: {
              compaction: {
                summary,
                compactedMessageIds,
                createdAt: Date.now(),
              },
            },
            parts: [{ type: 'text', text }],
          }
          chat.messages = [reset]
          return { summary, cutMessageId: reset.id, forkedSessionId }
        }
        const cut: LoopMessage = {
          id: randomUUID(),
          role: 'user',
          metadata: {
            compaction: {
              summary,
              compactedMessageIds: chat.messages.map((m) => m.id),
              createdAt: Date.now(),
            },
          },
          parts: [{ type: 'text', text }],
        }
        chat.messages = [...chat.messages, cut]
        return { summary, cutMessageId: cut.id, forkedSessionId }
      } finally {
        compacting = false
      }
    })()

    const settled = run.then(
      () => {},
      () => {},
    )
    compaction = settled
    settled.then(() => {
      if (compaction === settled) compaction = undefined
    })
    return run
  }

  const streamChunks = (): AsyncGenerator<UIMessageChunk> =>
    (async function* () {
      const queue: UIMessageChunk[] = []
      let notify: () => void = () => {}
      let ended = false
      const listener = (chunk: UIMessageChunk) => {
        queue.push(chunk)
        notify()
      }
      const end = () => {
        ended = true
        notify()
      }
      streamListeners.add(listener)
      runEndListeners.add(end)
      try {
        while (true) {
          if (queue.length === 0) {
            if (ended) return
            await new Promise<void>((resolve) => {
              notify = resolve
            })
          }
          const chunk = queue.shift()
          if (chunk) yield chunk
        }
      } finally {
        streamListeners.delete(listener)
        runEndListeners.delete(end)
      }
    })()

  return {
    id,
    get status() {
      return chat.status
    },
    get error() {
      return chat.error
    },
    get messages() {
      return chat.messages
    },
    get lastMessage() {
      return chat.messages[chat.messages.length - 1]
    },
    get config() {
      return effectiveConfig()
    },
    get title() {
      return title
    },
    setTitle: (next: string) => {
      title = next
      persistMeta({ title: next })
    },
    get skills() {
      return listSkills()
    },
    get workflows() {
      return listCommands().filter((c) => c.kind === 'workflow')
    },
    get rules() {
      return listRules()
    },
    get agents() {
      return listAgents()
    },
    get mcp() {
      return {
        servers: () => loop.mcp.snapshot(),
        tools: async () => Object.keys(await loop.mcp.tools()),
        refresh: () => loop.mcp.refresh(),
        reload: async () => {
          await loop.mcp.close()
          await loop.mcp.connectAll()
        },
      }
    },
    get usage() {
      return lastUsage
    },
    get state(): SessionState {
      return deriveState(chat)
    },
    summarize: async (): Promise<SummarizeResult> => {
      const config = effectiveConfig()
      return summarizeSession({
        messages: chat.messages,
        modelKey: config.modelKey,
        thinking: config.thinking,
      })
    },
    undo: () => {
      assertEditable('undo')
      return new CheckpointStore(checkpointsPath(folderKey, id)).undo()
    },
    redo: () => {
      assertEditable('redo')
      return new CheckpointStore(checkpointsPath(folderKey, id)).redo()
    },
    revertToMessage: (messageId) => {
      assertNotRunning('revert')
      const index = chat.messages.findIndex((m) => m.id === messageId)
      if (index < 0) throw new Error(`Unknown message "${messageId}"`)
      chat.messages = chat.messages.slice(0, index + 1)
    },
    sendMessage: ((message, requestOptions) => {
      if (message !== undefined && (resuming || isWaiting(chat.messages))) {
        return new Promise<void>((resolve, reject) => {
          pendingPrompts.push({ id: randomUUID(), queuedAt: Date.now(), steered: false, message: toPromptMessage(message as SessionPrompt), resolve, reject })
          emitQueue()
          void drain()
        })
      }
      return chat.sendMessage(message, requestOptions)
    }) as Chat['sendMessage'],
    regenerate: (options) => chat.regenerate(options),
    stop: () => {
      markAborting()
      return chat.stop()
    },
    abort: () => {
      settlePending()
      if (isRunning()) requestStop()
    },
    clearError: () => chat.clearError(),
    addToolOutput: (options) => chat.addToolOutput(options),
    respondFlowTool: async ({ tool, toolCallId, output }) => {
      if (tool !== 'ask' && tool !== 'plan-write') throw new Error(`Unknown flow tool "${tool}"`)
      if (isRunning()) throw new Error('Cannot answer while a run is in progress')
      const last = chat.messages[chat.messages.length - 1]
      if (last?.role !== 'assistant') throw new Error('No pending question to answer')
      const found = findFlowPart(chat.messages, tool, toolCallId)
      if (!found || found.message.id !== last.id) throw new Error('No pending question to answer')
      if (flowOutputStatus(found.part) !== 'pending') throw new Error('This question was already answered')
      if (tool === 'plan-write' && output.status !== 'approved') planHandoffCompact = false
      resumeOnce = true
      resuming = true
      try {
        await chat.addToolOutput({ tool: tool as never, toolCallId, output: output as never })
      } catch (error) {
        resumeOnce = false
        resuming = false
        throw error
      }
    },
    setPlanHandoffCompact: (compact) => {
      planHandoffCompact = compact
    },
    switchAgent: (agentId) => {
      if (!AGENTS[agentId]) throw new Error(`Unknown agent "${agentId}". Known agents: ${Object.keys(AGENTS).join(', ')}`)
      overrides.agentId = agentId
    },
    switchModel: (modelKey) => {
      const ref = resolveModelRef(modelKey)
      if (`${ref.provider.id}/${ref.modelId}` !== modelKey) {
        throw new Error(`Unknown model "${modelKey}".`)
      }
      overrides.modelKey = modelKey
    },
    switchThinking: (thinking) => {
      overrides.thinking = thinking
    },
    queue: (prompt) => {
      pendingPrompts.push({ id: randomUUID(), queuedAt: Date.now(), steered: false, message: toPromptMessage(prompt) })
      emitQueue()
      void drain()
    },
    get queued() {
      return snapshotQueued()
    },
    get queuedCount() {
      return pendingPrompts.length
    },
    removeQueued: (id) => {
      const index = pendingPrompts.findIndex((item) => item.id === id)
      if (index < 0) return false
      const [item] = pendingPrompts.splice(index, 1)
      item?.reject?.(Object.assign(new Error('Dequeued'), { name: 'AbortError' }))
      emitQueue()
      return true
    },
    onQueueChange: (listener) => {
      queueListeners.add(listener)
      return () => {
        queueListeners.delete(listener)
      }
    },
    dequeueNewest: () => {
      const item = pendingPrompts.pop()
      if (!item) return undefined
      item.reject?.(Object.assign(new Error('Dequeued'), { name: 'AbortError' }))
      emitQueue()
      return {
        id: item.id,
        text: queuedTextFromMessage(item.message),
        queuedAt: item.queuedAt,
        steered: item.steered,
        files: queuedFilesFromMessage(item.message),
      }
    },
    stream: streamChunks,
    streamMessages: () => {
      const chunks = streamChunks()
      return readUIMessageStream<LoopMessage>({
        message: { id: generateId(), role: 'assistant', parts: [] } as LoopMessage,
        stream: new ReadableStream<UIMessageChunk>({
          async pull(controller) {
            const { done, value } = await chunks.next()
            try {
              if (done) controller.close()
              else controller.enqueue(value)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (message.includes('Controller is already closed')) return
              throw error
            }
          },
        }),
        terminateOnError: false,
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      })
    },
    steer: (prompt) =>
      new Promise<void>((resolve, reject) => {
        if (resuming || isWaiting(chat.messages)) {
          pendingPrompts.push({ id: randomUUID(), queuedAt: Date.now(), steered: false, message: toPromptMessage(prompt), resolve, reject })
          emitQueue()
          return
        }
        pendingPrompts.unshift({ id: randomUUID(), queuedAt: Date.now(), steered: isRunning(), message: toPromptMessage(prompt), resolve, reject })
        emitQueue()
        if (isRunning()) {
          requestStop()
        } else {
          void drain()
        }
      }),
    compact: (opts) => compactInternal(opts ?? {}),
    uncompact: () => {
      assertNotRunning('uncompact')
      for (let i = chat.messages.length - 1; i >= 0; i--) {
        if (!isCompactionCut(chat.messages[i])) continue
        chat.messages = chat.messages.filter((_, index) => index !== i)
        return
      }
      throw new Error('Nothing to uncompact: the session has no compaction cut')
    },
    flush: () => saver.flush(),
    close: async () => {
      settlePending()
      if (isRunning()) {
        markAborting()
        try {
          await chat.stop()
        } catch {}
      }
      await saver.flush()
      await loop.mcp.close()
    },
  }
}
