import { getAgent } from '@agent/agents/registry.ts'
import { canWriteFiles, getSubagent, listSubagents, prepareSubagent, SUBAGENT_DEPTH_CAP } from '@agent/agents/subagents.ts'
import type { LoopConfig } from '@agent/loop/create-loop.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import { generateSessionTitle } from '@agent/prompts/session-title.ts'
import { createSession, type Session, type SessionPrompt, toPromptMessage } from '@agent/sessions/session.ts'
import type { JobTracker } from '@agent/sessions/session-jobs.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import { lastAssistantText } from '@agent/sessions/session-messages.ts'
import { generateSessionId } from '@agent/sessions/session-paths.ts'
import { truncate } from '@shared/text-stats.ts'

export interface SpawnSubSessionParams {
  parentId: string
  subagent: string
  prompt: SessionPrompt
  depth: number
  sessionId?: string
  description?: string
  taskId?: string
}

export interface SpawnContext {
  manager: SessionManager
  cwd: string
  maxAgents: number
  live: Map<string, Session>
  jobs: JobTracker
  baseConfig: (overrides?: { agentId?: string; modelKey?: string; sessionId?: string; agentOverride?: LoopConfig['agentOverride']; subagent?: boolean; spawn?: LoopConfig['spawn'] }) => LoopConfig
}

export async function spawnSubSession(
  ctx: SpawnContext,
  { parentId, subagent, prompt, depth, sessionId: requestedSessionId, description, taskId }: SpawnSubSessionParams,
): Promise<{
  sessionId: string
  summary: string
}> {
  if (ctx.maxAgents <= 0) throw new Error('Spawning is disabled (maxAgents is 0)')
  if (depth >= SUBAGENT_DEPTH_CAP) {
    throw new Error(`Sub agent depth cap of ${SUBAGENT_DEPTH_CAP} reached; report your findings instead of spawning deeper`)
  }
  if (taskId) {
    const prior = ctx.jobs.get(taskId)
    if (!prior) throw new Error(`Unknown taskId "${taskId}": no previous subagent session with that id`)
  }
  const def = await getSubagent(subagent, ctx.cwd)
  if (!def) {
    const known = (await listSubagents(ctx.cwd)).map((s) => s.name).join(', ')
    throw new Error(`Unknown subagent "${subagent}". Known subagents: ${known}`)
  }
  const parentSession = ctx.live.get(parentId)
  if (parentSession) {
    const parentConfig = parentSession.config
    const parentAgent = parentConfig.agentOverride ?? getAgent(parentConfig.agentId)
    if (!canWriteFiles(parentAgent.tools) && canWriteFiles(def.tools)) {
      throw new Error(`Read-only agents cannot spawn write-capable subagents ("${def.name}")`)
    }
  }
  const parentModelKey = ctx.live.get(parentId)?.config.modelKey ?? ctx.baseConfig().modelKey

  const nested = depth > 0
  if (nested && ctx.jobs.activeSlots >= ctx.maxAgents) {
    throw new Error('Agent concurrency limit reached — wait for the current sub agents to finish, then retry')
  }
  const sessionId = requestedSessionId ?? generateSessionId()
  ctx.jobs.set({
    sessionId,
    parentId,
    subagent,
    state: 'running',
    queued: !nested,
    startedAt: Date.now(),
  })
  let slotAcquired = false
  let child: Session | undefined
  let costRolledUp = false
  const rollUpCost = (): void => {
    const childStats = child?.stats
    if (!childStats || costRolledUp) return
    costRolledUp = true
    ctx.live.get(parentId)?.addExternalCost(childStats.total.cost)
  }
  try {
    if (!nested) {
      await ctx.jobs.acquireSlot(ctx.maxAgents)
      slotAcquired = true
    }
    ctx.jobs.patch(sessionId, { queued: false })
    const prepared = prepareSubagent(def)
    let modelKey = parentModelKey
    if (def.model) {
      const ref = resolveModelRef(def.model)
      if (`${ref.provider.id}/${ref.modelId}` === def.model) modelKey = def.model
    }
    const promptText =
      typeof prompt === 'string'
        ? prompt
        : Array.isArray((prompt as { parts?: unknown }).parts)
          ? (prompt as { parts: Array<{ type?: unknown; text?: unknown }> }).parts
              .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
              .map((entry) => entry.text as string)
              .join('\n')
          : ''
    const fallbackTitle = description?.trim()
      ? `${description.trim()} (@${subagent} subagent)`
      : promptText.trim()
        ? `${subagent}: ${truncate(promptText.replace(/\s+/g, ' ').trim())}`
        : `${subagent}: sub session`
    child = await createSession({
      config: () => ctx.baseConfig({ modelKey, sessionId, agentOverride: prepared, subagent: true, spawn: { manager: ctx.manager, parentId: sessionId, depth: depth + 1 } }),
      id: sessionId,
      meta: { cwd: ctx.cwd, parentSessionId: parentId, title: taskId ? `${fallbackTitle} (continues ${taskId.slice(0, 8)})` : fallbackTitle },
    })
    ctx.live.set(sessionId, child)
    const created = child
    if (promptText.trim()) {
      generateSessionTitle(promptText, undefined, { sessionId })
        .then((generated) => {
          created.setTitle(generated)
        })
        .catch(() => {})
    }
    try {
      await child.sendMessage(toPromptMessage(prompt))
      if (child.error) throw child.error
      const report = lastAssistantText(child.messages)
      let summary = report
      if (!summary) {
        const result = await child.summarize().catch(() => undefined)
        summary = result?.summary ?? '(sub agent produced no output)'
      }
      const childStats = child.stats
      rollUpCost()
      ctx.jobs.patch(sessionId, {
        state: 'finished',
        ...(childStats ? { stats: { usage: childStats.total.usage, cost: childStats.total.cost, stepCount: childStats.stepCount ?? 0 } } : {}),
      })
      return {
        sessionId,
        summary,
      }
    } finally {
      ctx.live.delete(sessionId)
      await child?.close().catch(() => {})
    }
  } catch (error) {
    rollUpCost()
    const childStats = child?.stats
    ctx.jobs.patch(sessionId, {
      state: 'error',
      ...(childStats ? { stats: { usage: childStats.total.usage, cost: childStats.total.cost, stepCount: childStats.stepCount ?? 0 } } : {}),
    })
    throw error
  } finally {
    if (slotAcquired) ctx.jobs.releaseSlot()
  }
}
