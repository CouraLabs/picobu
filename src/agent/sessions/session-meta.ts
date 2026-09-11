import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoopUsageComputed, LoopUsageComputedCost } from '@agent/model/cost.ts'
import { zeroComputedCost } from '@agent/model/cost.ts'
import { folderKeyFor, sessionsRoot } from '@agent/sessions/session-paths.ts'
import { withLock } from '@shared/lock.ts'
import { z } from 'zod'

export type SessionState = 'waiting' | 'finished' | 'error' | 'running'

export const BLOCKING_FLOW_TOOLS: readonly string[] = ['ask', 'plan-write']
type LooseToolPart = {
  type: string
  toolName?: unknown
  output?: unknown
}

export function isWaiting(messages: { role: string; parts: unknown[] }[]): boolean {
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return false
  return last.parts.some((raw) => {
    const part = raw as LooseToolPart
    if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return false
    const name = part.type === 'dynamic-tool' ? String(part.toolName ?? '') : part.type.slice('tool-'.length)
    if (!BLOCKING_FLOW_TOOLS.includes(name)) return false
    const output = part.output
    return typeof output === 'object' && output !== null && (output as { status?: unknown }).status === 'pending'
  })
}

export type CostDetail = {
  source: 'run' | 'subagent'
  sessionId?: string
  subagent?: string
  modelKey?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
  textTokens?: number
  totalTokens?: number
  noCacheInputTokens?: number
  cost?: LoopUsageComputedCost
}

export type CostDetails = LoopUsageComputedCost & {
  details: CostDetail[]
}

export type SessionTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  textTokens: number
  totalTokens: number
  noCacheInputTokens: number
  computed: LoopUsageComputed
  costDetails: CostDetails
}

const emptyCost = (): LoopUsageComputedCost => zeroComputedCost()

export const emptyTotals = (): SessionTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  textTokens: 0,
  totalTokens: 0,
  noCacheInputTokens: 0,
  computed: {
    accNoCacheInputTokens: 0,
    accOutputTokens: 0,
    accCacheReadTokens: 0,
    accCacheWriteTokens: 0,
    accReasoningTokens: 0,
    accTextTokens: 0,
  },
  costDetails: { ...emptyCost(), details: [] },
})

const detailNoCache = (detail: CostDetail): number => detail.noCacheInputTokens ?? Math.max(0, detail.inputTokens - detail.cacheReadTokens - detail.cacheWriteTokens)

const mergeCost = (base: LoopUsageComputedCost | undefined, add: LoopUsageComputedCost | undefined): LoopUsageComputedCost | undefined => {
  if (!base && !add) return undefined
  const b = base ?? zeroComputedCost()
  const a = add ?? zeroComputedCost()
  const inputCost = b.inputCost + a.inputCost
  const outputCost = b.outputCost + a.outputCost
  const cacheReadCost = b.cacheReadCost + a.cacheReadCost
  const cacheWriteCost = b.cacheWriteCost + a.cacheWriteCost
  return { inputCost, outputCost, cacheReadCost, cacheWriteCost, cacheCost: cacheReadCost + cacheWriteCost, total: inputCost + outputCost + cacheReadCost + cacheWriteCost }
}

const mergeTotals = (totals: SessionTotals, detail: CostDetail, appendDetail: boolean): SessionTotals => {
  const noCache = detailNoCache(detail)
  const totalTokens = detail.totalTokens ?? detail.inputTokens + detail.outputTokens
  const accNoCacheInputTokens = totals.computed.accNoCacheInputTokens + noCache
  const accOutputTokens = totals.computed.accOutputTokens + detail.outputTokens
  const accCacheReadTokens = totals.computed.accCacheReadTokens + detail.cacheReadTokens
  const accCacheWriteTokens = totals.computed.accCacheWriteTokens + detail.cacheWriteTokens
  const accReasoningTokens = totals.computed.accReasoningTokens + (detail.reasoningTokens ?? 0)
  const accTextTokens = totals.computed.accTextTokens + (detail.textTokens ?? 0)
  const computedCost = mergeCost(totals.computed.cost, detail.cost)
  const base = totals.costDetails
  const costDetails: CostDetails = {
    inputCost: base.inputCost + (detail.cost?.inputCost ?? 0),
    outputCost: base.outputCost + (detail.cost?.outputCost ?? 0),
    cacheReadCost: base.cacheReadCost + (detail.cost?.cacheReadCost ?? 0),
    cacheWriteCost: base.cacheWriteCost + (detail.cost?.cacheWriteCost ?? 0),
    cacheCost: base.cacheCost + (detail.cost?.cacheCost ?? 0),
    total: base.total + (detail.cost?.total ?? 0),
    details: appendDetail ? [...base.details, detail] : base.details,
  }
  return {
    inputTokens: totals.inputTokens + detail.inputTokens,
    outputTokens: totals.outputTokens + detail.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + detail.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens + detail.cacheWriteTokens,
    reasoningTokens: totals.reasoningTokens + (detail.reasoningTokens ?? 0),
    textTokens: totals.textTokens + (detail.textTokens ?? 0),
    totalTokens: totals.totalTokens + totalTokens,
    noCacheInputTokens: totals.noCacheInputTokens + noCache,
    computed: {
      accNoCacheInputTokens,
      accOutputTokens,
      accCacheReadTokens,
      accCacheWriteTokens,
      accReasoningTokens,
      accTextTokens,
      ...(computedCost ? { cost: computedCost } : {}),
    },
    costDetails,
  }
}

export function addToTotals(totals: SessionTotals, detail: CostDetail): SessionTotals {
  return mergeTotals(totals, detail, true)
}

export function liveTotals(totals: SessionTotals, detail: CostDetail): SessionTotals {
  return mergeTotals(totals, detail, false)
}

const costSchema = z.object({
  inputCost: z.number(),
  outputCost: z.number(),
  cacheReadCost: z.number(),
  cacheWriteCost: z.number(),
  cacheCost: z.number(),
  total: z.number(),
})

const computedSchema: z.ZodType<LoopUsageComputed> = z.object({
  accNoCacheInputTokens: z.number(),
  accOutputTokens: z.number(),
  accCacheReadTokens: z.number(),
  accCacheWriteTokens: z.number(),
  accReasoningTokens: z.number(),
  accTextTokens: z.number(),
  cost: costSchema.optional(),
})

const totalsSchema: z.ZodType<SessionTotals> = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number().optional().default(0),
  textTokens: z.number().optional().default(0),
  totalTokens: z.number().optional().default(0),
  noCacheInputTokens: z.number().optional().default(0),
  computed: computedSchema,
  costDetails: z.object({
    inputCost: z.number().optional().default(0),
    outputCost: z.number().optional().default(0),
    cacheReadCost: z.number().optional().default(0),
    cacheWriteCost: z.number().optional().default(0),
    cacheCost: z.number().optional().default(0),
    total: z.number().optional().default(0),
    details: z.array(z.any()),
  }),
})
const metaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  state: z.enum(['waiting', 'finished', 'error', 'running']),
  parentSessionId: z.string().optional(),
  cwd: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  modelKey: z.string().optional(),
  totals: totalsSchema.optional(),
})

export type SessionMeta = z.infer<typeof metaSchema>

export const sessionMetaPath = (folderKey: string, sessionId: string): string => join(sessionsRoot(), folderKey, `${sessionId}.meta.json`)

export async function readSessionMeta(folderKey: string, sessionId: string): Promise<SessionMeta | null> {
  let raw: string
  try {
    raw = await readFile(sessionMetaPath(folderKey, sessionId), 'utf8')
  } catch {
    return null
  }
  try {
    return metaSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writeSessionMeta(folderKey: string, sessionId: string, meta: SessionMeta): Promise<void> {
  const path = sessionMetaPath(folderKey, sessionId)
  await withLock(path, async () => {
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true })
    await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`)
  })
}

export async function folderKeyForSession(cwd: string, sessionId: string): Promise<string> {
  const meta = await readSessionMeta(folderKeyFor(cwd), sessionId)
  return folderKeyFor(meta?.cwd ?? cwd)
}

export async function updateSessionMeta(folderKey: string, sessionId: string, patch: Partial<Omit<SessionMeta, 'id'>>): Promise<SessionMeta | null> {
  const path = sessionMetaPath(folderKey, sessionId)
  return withLock(path, async () => {
    let current: SessionMeta | null = null
    try {
      current = metaSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch {
      return null
    }
    const next: SessionMeta = { ...current, ...patch, id: sessionId, updatedAt: Date.now() }
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true })
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}
export async function deleteSessionMeta(folderKey: string, sessionId: string): Promise<void> {
  try {
    await rm(sessionMetaPath(folderKey, sessionId), { force: true })
  } catch {}
}

export async function recoverSessionMeta(folderKey: string, sessionId: string): Promise<SessionMeta | null> {
  const meta = await readSessionMeta(folderKey, sessionId)
  if (meta?.state !== 'running') return meta
  return updateSessionMeta(folderKey, sessionId, { state: 'error' })
}
