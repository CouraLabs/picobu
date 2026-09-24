export type SessionStatusItemId =
  | 'agent'
  | 'model'
  | 'effort'
  | 'run-state'
  | 'loading'
  | 'session-title'
  | 'todo'
  | 'ttft'
  | 'tps'
  | 'tool-time'
  | 'input'
  | 'output'
  | 'cache'
  | 'cost'
  | 'sandbox'
  | 'msgs'
  | 'tools'
  | 'mcp'
  | 'queue'
  | 'jobs'
  | 'provider-items'
export type SessionHeaderItemId = 'workspace' | 'context' | 'notification'
export type SessionStatusItem = SessionStatusItemId | 'separator'
export type SessionHeaderItem = SessionHeaderItemId | 'separator'
export type SessionLayoutLines<TItem> = Array<Array<TItem>>
export interface SessionLayoutConfig<TItem> {
  lines: SessionLayoutLines<TItem>
  columnGap: number
  rowGap: number
}
export type SessionStatusLayout = SessionLayoutConfig<SessionStatusItem>
export type SessionHeaderLayout = SessionLayoutConfig<SessionHeaderItem>

export const SESSION_STATUS_ITEM_IDS: Array<SessionStatusItemId> = [
  'agent',
  'model',
  'effort',
  'run-state',
  'loading',
  'session-title',
  'todo',
  'ttft',
  'tps',
  'tool-time',
  'input',
  'output',
  'cache',
  'cost',
  'sandbox',
  'msgs',
  'tools',
  'mcp',
  'queue',
  'jobs',
  'provider-items',
]
export const SESSION_HEADER_ITEM_IDS: Array<SessionHeaderItemId> = ['workspace', 'context', 'notification']
export const SESSION_STATUS_ITEM_LABELS: Record<SessionStatusItem, string> = {
  agent: 'Agent',
  model: 'Model',
  effort: 'Thinking effort',
  'run-state': 'Run state',
  loading: 'Loading spinner',
  'session-title': 'Session title',
  todo: 'Todos',
  ttft: 'TTFT',
  tps: 'Tokens/s',
  'tool-time': 'Tool exec time',
  input: 'Input tokens',
  output: 'Output tokens',
  cache: 'Cache',
  cost: 'Cost',
  sandbox: 'Sandbox',
  msgs: 'Messages',
  tools: 'Tool calls',
  mcp: 'MCP',
  queue: 'Queue',
  jobs: 'Background jobs',
  'provider-items': 'Provider items',
  separator: 'Separator',
}
export const SESSION_HEADER_ITEM_LABELS: Record<SessionHeaderItem, string> = {
  workspace: 'Workspace',
  context: 'Context',
  notification: 'Notification',
  separator: 'Separator',
}

export const SEPARATOR_ITEM = 'separator'
export const MIN_LAYOUT_GAP = 0
export const MAX_LAYOUT_GAP = 4
export const MAX_SESSION_LAYOUT_LINES = 6
export const MAX_SESSION_LAYOUT_ITEMS_PER_LINE = 32
export const DEFAULT_COLUMN_GAP = 1
export const DEFAULT_ROW_GAP = 0

export const DEFAULT_SESSION_STATUS_LAYOUT: SessionStatusLayout = {
  lines: [
    ['agent', 'separator', 'model', 'separator', 'effort', 'separator', 'run-state', 'separator', 'loading', 'session-title'],
    ['ttft', 'tps', 'separator', 'input', 'output', 'cache', 'cost'],
    ['sandbox', 'separator', 'msgs', 'tools', 'separator', 'queue', 'separator', 'jobs', 'separator', 'todo'],
    ['provider-items'],
  ],
  columnGap: DEFAULT_COLUMN_GAP,
  rowGap: DEFAULT_ROW_GAP,
}
export const DEFAULT_SESSION_HEADER_LAYOUT: SessionHeaderLayout = {
  lines: [['workspace', 'notification', 'context']],
  columnGap: DEFAULT_COLUMN_GAP,
  rowGap: DEFAULT_ROW_GAP,
}

export interface LayoutLocation {
  line: number
  index: number
}

export const isSessionStatusItemId = (value: unknown): value is SessionStatusItemId => SESSION_STATUS_ITEM_IDS.includes(value as SessionStatusItemId)
export const isSessionHeaderItemId = (value: unknown): value is SessionHeaderItemId => SESSION_HEADER_ITEM_IDS.includes(value as SessionHeaderItemId)
export const isSessionStatusItem = (value: unknown): value is SessionStatusItem => value === SEPARATOR_ITEM || isSessionStatusItemId(value)
export const isSessionHeaderItem = (value: unknown): value is SessionHeaderItem => value === SEPARATOR_ITEM || isSessionHeaderItemId(value)

export const normalizeLayoutGap = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return Math.min(MAX_LAYOUT_GAP, Math.max(MIN_LAYOUT_GAP, floored))
}

const isSeparator = <TItem>(item: TItem): boolean => item === (SEPARATOR_ITEM as unknown as TItem)

const sanitizeLine = <TItem>(line: unknown[], isItem: (value: unknown) => boolean): Array<TItem> => {
  const cleaned: Array<TItem> = []
  const seen = new Set<unknown>()
  for (const raw of line) {
    if (typeof raw !== 'string') continue
    if (!isItem(raw)) continue
    if (raw === SEPARATOR_ITEM) {
      cleaned.push(SEPARATOR_ITEM as unknown as TItem)
      continue
    }
    if (seen.has(raw)) continue
    seen.add(raw)
    cleaned.push(raw as TItem)
  }
  const capped = cleaned.slice(0, MAX_SESSION_LAYOUT_ITEMS_PER_LINE)
  const collapsed: Array<TItem> = []
  for (const item of capped) {
    if (isSeparator(item) && (collapsed.length === 0 || isSeparator(collapsed[collapsed.length - 1]))) continue
    collapsed.push(item)
  }
  while (collapsed.length > 0 && isSeparator(collapsed[collapsed.length - 1])) collapsed.pop()
  return collapsed
}

export const collapseSeparators = <TItem>(items: Array<TItem>, isVisible: (item: TItem) => boolean): Array<TItem> => {
  const result: Array<TItem> = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item === undefined) continue
    if (!isSeparator(item)) {
      if (isVisible(item)) result.push(item)
      continue
    }
    const previous = result[result.length - 1]
    const hasBefore = result.length > 0 && previous !== undefined && !isSeparator(previous) && isVisible(previous)
    if (!hasBefore) continue
    let hasAfter = false
    for (let next = index + 1; next < items.length; next += 1) {
      const upcoming = items[next]
      if (upcoming === undefined) continue
      if (isSeparator(upcoming)) continue
      if (isVisible(upcoming)) {
        hasAfter = true
        break
      }
    }
    if (hasAfter) result.push(item)
  }
  return result
}

export const lineHasVisibleItem = <TItem>(items: Array<TItem> | undefined, isVisible: (item: TItem) => boolean): boolean => {
  if (!items) return false
  return items.some((item) => !isSeparator(item) && isVisible(item))
}

const sanitizeLines = <TItem>(lines: unknown, isItem: (value: unknown) => boolean): Array<Array<TItem>> => {
  if (!Array.isArray(lines)) return []
  const cleaned: Array<Array<TItem>> = []
  for (const line of lines) {
    if (!Array.isArray(line)) continue
    const sanitized = sanitizeLine<TItem>(line, isItem)
    if (sanitized.length === 0) continue
    cleaned.push(sanitized)
    if (cleaned.length >= MAX_SESSION_LAYOUT_LINES) break
  }
  return cleaned
}

const configFrom = <TItem>(value: unknown, fallback: SessionLayoutConfig<TItem>, isItem: (value: unknown) => boolean): SessionLayoutConfig<TItem> => {
  const lines = sanitizeLines<TItem>(typeof value === 'object' && value !== null && Array.isArray((value as { lines?: unknown }).lines) ? (value as { lines: unknown }).lines : value, isItem)
  const source = typeof value === 'object' && value !== null ? (value as { columnGap?: unknown; rowGap?: unknown }) : {}
  const isObjectConfig = typeof value === 'object' && value !== null && Array.isArray((value as { lines?: unknown }).lines)
  if (lines.length === 0)
    return isObjectConfig ? { lines: [], columnGap: normalizeLayoutGap(source.columnGap, fallback.columnGap), rowGap: normalizeLayoutGap(source.rowGap, fallback.rowGap) } : fallback
  return {
    lines,
    columnGap: normalizeLayoutGap(source.columnGap, fallback.columnGap),
    rowGap: normalizeLayoutGap(source.rowGap, fallback.rowGap),
  }
}

export const normalizeSessionStatusLayout = (value: unknown): SessionStatusLayout => configFrom(value, DEFAULT_SESSION_STATUS_LAYOUT, isSessionStatusItem)
export const normalizeSessionHeaderLayout = (value: unknown): SessionHeaderLayout => {
  const config = configFrom(value, DEFAULT_SESSION_HEADER_LAYOUT, isSessionHeaderItem)
  return { ...config, lines: config.lines.slice(0, 1) }
}

const cloneLines = <TItem>(lines: SessionLayoutLines<TItem>): SessionLayoutLines<TItem> => lines.map((line) => [...line])
export const cloneLayout = <TItem>(layout: SessionLayoutConfig<TItem>): SessionLayoutConfig<TItem> => ({ lines: cloneLines(layout.lines), columnGap: layout.columnGap, rowGap: layout.rowGap })
export const toLayoutConfig = <TItem>(items: Array<TItem>): SessionLayoutConfig<TItem> => ({ lines: items.length > 0 ? [[...items]] : [], columnGap: DEFAULT_COLUMN_GAP, rowGap: DEFAULT_ROW_GAP })
export const flattenLayoutLines = <TItem>(layout: SessionLayoutConfig<TItem>): Array<TItem> => layout.lines[0] ?? []

const lineAt = <TItem>(lines: SessionLayoutLines<TItem>, line: number): Array<TItem> | undefined => {
  if (line < 0 || line >= lines.length) return undefined
  return lines[line]
}

const atLocation = <TItem>(lines: SessionLayoutLines<TItem>, at: LayoutLocation): TItem | undefined => lineAt(lines, at.line)?.[at.index]

export const insertLayoutItem = <TItem>(layout: SessionLayoutConfig<TItem>, at: LayoutLocation, item: TItem): SessionLayoutConfig<TItem> => {
  const next = cloneLayout(layout)
  const line = lineAt(next.lines, at.line)
  if (!line) return next
  const index = Math.min(Math.max(at.index, 0), line.length)
  line.splice(index, 0, item)
  return next
}

export const removeLayoutItem = <TItem>(layout: SessionLayoutConfig<TItem>, at: LayoutLocation): { layout: SessionLayoutConfig<TItem>; removed?: TItem } => {
  const next = cloneLayout(layout)
  const line = lineAt(next.lines, at.line)
  if (!line || at.index < 0 || at.index >= line.length) return { layout: next }
  const [removed] = line.splice(at.index, 1)
  if (line.length === 0) next.lines.splice(at.line, 1)
  return { layout: next, removed }
}

export const moveLayoutItem = <TItem>(layout: SessionLayoutConfig<TItem>, from: LayoutLocation, to: LayoutLocation): SessionLayoutConfig<TItem> => {
  const item = atLocation(layout.lines, from)
  if (item === undefined) return layout
  const afterRemove = removeLayoutItem(layout, from)
  let target = { ...to }
  if (target.line > from.line && afterRemove.layout.lines.length < layout.lines.length) target = { ...target, line: target.line - 1 }
  return insertLayoutItem(afterRemove.layout, target, item)
}

export const appendLayoutLine = <TItem>(layout: SessionLayoutConfig<TItem>): SessionLayoutConfig<TItem> => {
  const next = cloneLayout(layout)
  if (next.lines.length >= MAX_SESSION_LAYOUT_LINES) return next
  next.lines.push([])
  return next
}

export const removeLayoutLine = <TItem>(layout: SessionLayoutConfig<TItem>, line: number): SessionLayoutConfig<TItem> => {
  const next = cloneLayout(layout)
  if (line < 0 || line >= next.lines.length) return next
  next.lines.splice(line, 1)
  return next
}

export const setLayoutGaps = <TItem>(layout: SessionLayoutConfig<TItem>, gaps: { columnGap?: number; rowGap?: number }): SessionLayoutConfig<TItem> => ({
  lines: cloneLines(layout.lines),
  columnGap: normalizeLayoutGap(gaps.columnGap ?? layout.columnGap, layout.columnGap),
  rowGap: normalizeLayoutGap(gaps.rowGap ?? layout.rowGap, layout.rowGap),
})

const placedIds = <TItem>(layout: SessionLayoutConfig<TItem>): Set<unknown> => {
  const placed = new Set<unknown>()
  for (const line of layout.lines) for (const item of line) if (!isSeparator(item)) placed.add(item)
  return placed
}

export const unusedStatusItems = (layout: SessionStatusLayout): Array<SessionStatusItem> => SESSION_STATUS_ITEM_IDS.filter((id) => !placedIds(layout).has(id))
export const unusedHeaderItems = (layout: SessionHeaderLayout): Array<SessionHeaderItem> => SESSION_HEADER_ITEM_IDS.filter((id) => !placedIds(layout).has(id))
