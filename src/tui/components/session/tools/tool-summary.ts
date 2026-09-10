import { icons } from '@tui/themes/icons.ts'

export type ToolPartLike = {
  type: string
  toolName?: string
  toolCallId?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export type ToolTone = 'running' | 'pending' | 'success' | 'error' | 'warning' | 'info'

export type ToolStateView = {
  icon: string
  tone: ToolTone
}

const DYNAMIC_TOOL_TYPE = 'dynamic-tool'
const TOOL_TYPE_PREFIX = 'tool-'

export const isToolPart = (part: unknown): part is ToolPartLike =>
  typeof part === 'object' &&
  part !== null &&
  typeof (part as { type?: unknown }).type === 'string' &&
  ((part as { type: string }).type.startsWith(TOOL_TYPE_PREFIX) || (part as { type: string }).type === DYNAMIC_TOOL_TYPE)

export const asToolPart = (part: unknown): ToolPartLike | undefined => (isToolPart(part) ? part : undefined)

export const rawToolName = (part: ToolPartLike): string => (part.type === DYNAMIC_TOOL_TYPE ? (part.toolName ?? 'tool') : part.type.slice(TOOL_TYPE_PREFIX.length))

export const isSpawnTool = (part: ToolPartLike): boolean => rawToolName(part).toLowerCase() === 'spawn'

export const spawnSubagentName = (input: unknown): string | undefined => {
  const name = (input as { subagent?: unknown } | undefined)?.subagent
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

export const spawnSessionId = (output: unknown): string | undefined => {
  const id = (output as { sessionId?: unknown } | undefined)?.sessionId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

export const spawnSummary = (output: unknown): string | undefined => {
  const summary = (output as { summary?: unknown } | undefined)?.summary
  return typeof summary === 'string' && summary.length > 0 ? summary : undefined
}

export type SpawnUsage = {
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  cost?: number
}

export const spawnUsage = (output: unknown): SpawnUsage | undefined => {
  const usage = (output as { usage?: unknown } | undefined)?.usage
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const inputTokens = typeof record.inputTokens === 'number' ? record.inputTokens : undefined
  const outputTokens = typeof record.outputTokens === 'number' ? record.outputTokens : undefined
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const cacheRead = typeof record.cacheRead === 'number' ? record.cacheRead : typeof record.cacheReadTokens === 'number' ? record.cacheReadTokens : 0
  const cacheWrite = typeof record.cacheWrite === 'number' ? record.cacheWrite : typeof record.cacheWriteTokens === 'number' ? record.cacheWriteTokens : 0
  const cost = typeof record.cost === 'number' ? record.cost : undefined
  return { inputTokens, outputTokens, cacheRead, cacheWrite, ...(cost !== undefined ? { cost } : {}) }
}

export const spawnPrompt = (input: unknown): string | undefined => {
  const prompt = (input as { prompt?: unknown } | undefined)?.prompt
  if (typeof prompt === 'string' && prompt.length > 0) return prompt
  return undefined
}

export const askTitles = (input: unknown): string[] => {
  const questions = (input as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(questions)) return []
  return questions.flatMap((q): string[] => {
    if (typeof q !== 'object' || q === null) return []
    const title = (q as { title?: unknown }).title
    return typeof title === 'string' && title.length > 0 ? [title] : []
  })
}

export const planFirstLine = (input: unknown): string | undefined => {
  const plan = (input as { plan?: unknown } | undefined)?.plan
  if (typeof plan !== 'string' || plan.length === 0) return undefined
  const first = plan
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return undefined
  const flat = first.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

export const planLineCount = (input: unknown): number | undefined => {
  const plan = (input as { plan?: unknown } | undefined)?.plan
  if (typeof plan !== 'string') return undefined
  return plan.length === 0 ? 0 : plan.split('\n').length
}

export const toolDisplayName = (part: ToolPartLike): string => {
  const name = rawToolName(part)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export const isPreliminaryToolResult = (part: ToolPartLike): boolean => (part as { preliminary?: unknown }).preliminary === true

export const toolStateView = (part: ToolPartLike): ToolStateView => {
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return { icon: icons.running, tone: 'running' }
    case 'output-available':
      if (isPreliminaryToolResult(part)) return { icon: icons.running, tone: 'running' }
      return { icon: icons.success, tone: 'success' }
    case 'output-error':
      return { icon: icons.error, tone: 'error' }
    case 'output-denied':
      return { icon: icons.warning, tone: 'warning' }
    case 'approval-requested':
      return { icon: icons.question, tone: 'pending' }
    case 'approval-responded':
      return { icon: icons.info, tone: 'info' }
    default:
      return { icon: icons.pending, tone: 'pending' }
  }
}

export const toolProgress = (part: ToolPartLike): string | undefined => {
  if (!isPreliminaryToolResult(part)) return undefined
  const progress = (part.output as { progress?: unknown } | undefined)?.progress
  return typeof progress === 'string' && progress.length > 0 ? progress : undefined
}

export const summarizeToolInput = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>
  const field = (key: string): string | undefined => {
    const value = args[key]
    return typeof value === 'string' ? value : undefined
  }
  switch (name.toLowerCase()) {
    case 'read': {
      const range = typeof args.fromLine === 'number' && typeof args.toLine === 'number' ? `:${args.fromLine}-${args.toLine}` : ''
      return `${field('path') ?? '?'}${range}`
    }
    case 'write':
    case 'edit':
      return field('path') ?? '?'
    case 'glob':
    case 'grep':
      return field('pattern') ?? '?'
    case 'shell':
      return field('command') ?? '?'
    case 'websearch':
      return field('query') ?? '?'
    case 'webfetch':
      return field('url') ?? '?'
    case 'skill':
    case 'rule':
      return field('name') ?? '?'
    case 'spawn':
      return field('subagent') ?? '?'
    case 'ask': {
      const titles = askTitles(input)
      if (titles.length === 0) return '?'
      return titles.join(' · ')
    }
    case 'plan-write': {
      const plan = field('plan')
      if (plan === undefined) return '?'
      const lines = plan.length === 0 ? 0 : plan.split('\n').length
      const first = planFirstLine(input)
      if (!first) return `${lines} lines`
      return lines <= 1 ? first : `${first} · ${lines} lines`
    }
    case 'todo': {
      const actionType = typeof args.actionType === 'string' ? args.actionType : ''
      const action = (args.action ?? {}) as Record<string, unknown>
      if (actionType === 'ins') {
        const added = Array.isArray(action.ins) ? action.ins : undefined
        return added ? `+${added.length}` : '?'
      }
      if (actionType === 'del') return 'remove'
      if (actionType === 'upd') return 'update'
      return '?'
    }
    default:
      return '?'
  }
}

const INPUT_PREVIEW_MAX = 120
const OUTPUT_PREVIEW_MAX = 200
const ERROR_PREVIEW_MAX = 400

const singleLine = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export const previewToolInput = (input: unknown): string => singleLine(input, INPUT_PREVIEW_MAX)

const countLines = (text: string): number => (text.length === 0 ? 0 : text.split(/\r?\n/).length)

export const summarizeToolError = (errorText: string): string => {
  if (/invalid (tool )?input/i.test(errorText)) return 'rejected: invalid input'
  return singleLine(errorText, ERROR_PREVIEW_MAX)
}

export const EXPANDED_MAX_LINES = 20

export const truncateLines = (text: string, max: number = EXPANDED_MAX_LINES): { text: string; remaining: number } => {
  if (text.length === 0) return { text, remaining: 0 }
  const lines = text.split(/\r?\n/)
  if (lines.length <= max) return { text, remaining: 0 }
  return { text: [...lines.slice(0, max), `… +${lines.length - max} more`].join('\n'), remaining: lines.length - max }
}

export const toolOutputText = (name: string, output: unknown): string | undefined => {
  if (output === undefined || output === null) return undefined
  const args = typeof output === 'object' ? (output as Record<string, unknown>) : undefined
  switch (name.toLowerCase()) {
    case 'glob':
      return typeof output === 'string' ? output : undefined
    case 'read':
    case 'grep':
    case 'webfetch': {
      const content = args && typeof args.content === 'string' ? args.content : undefined
      return content
    }
    case 'shell':
    case 'write':
      return typeof output === 'string' ? output : undefined
    default:
      return undefined
  }
}

export const summarizeToolOutput = (name: string, output: unknown, errorText?: string): string | undefined => {
  if (errorText) return summarizeToolError(errorText)
  if (output === undefined || output === null) return undefined
  if (output === '' && name.toLowerCase() !== 'glob') return undefined

  const args = typeof output === 'object' ? (output as Record<string, unknown>) : undefined
  switch (name.toLowerCase()) {
    case 'read':
    case 'grep': {
      const content = args && typeof args.content === 'string' ? args.content : undefined
      const filetype = args && typeof args.filetype === 'string' ? args.filetype : ''
      return content !== undefined ? `${countLines(content)} lines${filetype ? ` · ${filetype}` : ''}` : undefined
    }
    case 'glob':
      return typeof output === 'string' ? `${countLines(output)} matches` : undefined
    case 'write': {
      if (typeof output === 'string') return `${countLines(output)} lines written`
      const content = args && typeof args.content === 'string' ? args.content : undefined
      if (content !== undefined) return `${countLines(content)} lines written`
      const diff = args && typeof args.diff === 'string' ? args.diff : undefined
      if (diff === undefined) break
      const stats = diffStats(diff)
      return `${stats.added}+ ${stats.removed}−`
    }
    case 'edit': {
      const diff = args && typeof args.diff === 'string' ? args.diff : undefined
      if (diff === undefined) break
      const stats = diffStats(diff)
      return `${stats.added}+ ${stats.removed}−`
    }
    case 'shell': {
      if (typeof output !== 'string') break
      const lines = output.split(/\r?\n/)
      if (lines.length <= 1) return singleLine(output, OUTPUT_PREVIEW_MAX)
      const previewLine = [...lines].reverse().find((line) => {
        const trimmed = line.trim()
        return trimmed.length > 0 && !/^[}\])>;,.]+$/.test(trimmed)
      })
      return `${countLines(output)} lines${previewLine ? ` · ${singleLine(previewLine, 80)}` : ''}`
    }
    case 'websearch': {
      const results = args && Array.isArray(args.results) ? args.results : undefined
      return results ? `${results.length} results` : undefined
    }
    case 'ask': {
      const message = args && typeof args.message === 'string' ? args.message : undefined
      return message !== undefined && message.length > 0 ? singleLine(message, OUTPUT_PREVIEW_MAX) : undefined
    }
    case 'skill':
    case 'rule': {
      const description = args && typeof args.description === 'string' ? args.description : undefined
      return description !== undefined && description.length > 0 ? singleLine(description, OUTPUT_PREVIEW_MAX) : undefined
    }
    case 'plan-write': {
      const message = args && typeof args.message === 'string' ? args.message : undefined
      const status = args && typeof args.status === 'string' ? args.status : undefined
      const label = status !== undefined && status !== 'pending' ? `${status} · ` : ''
      return message !== undefined && message.length > 0 ? `${label}${singleLine(message, OUTPUT_PREVIEW_MAX)}` : status ? label.trim() : undefined
    }
    case 'todo': {
      const items = args && Array.isArray(args.items) ? args.items : undefined
      if (!items) break
      const done = items.filter((item) => (item as { done?: unknown } | undefined)?.done === true).length
      return `${done} of ${items.length} done`
    }
    case 'spawn': {
      const summary = args && typeof args.summary === 'string' ? args.summary : undefined
      return summary !== undefined && summary.length > 0 ? singleLine(summary, OUTPUT_PREVIEW_MAX) : undefined
    }
    case 'webfetch': {
      const content = args && typeof args.content === 'string' ? args.content : undefined
      return content !== undefined ? `${countLines(content)} lines` : undefined
    }
    default:
      return singleLine(output, OUTPUT_PREVIEW_MAX)
  }
}

export const diffStats = (diff: string): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line === '+++' || line === '---' || line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('+++\t') || line.startsWith('---\t')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

export const toolDiff = (output: unknown): string | undefined => {
  const diff = typeof output === 'object' && output !== null ? (output as { diff?: unknown }).diff : undefined
  return typeof diff === 'string' && diff.length > 0 ? diff : undefined
}

export type AskOptionView = {
  answer: string
  answerDescription?: string
}

export type AskQuestionView = {
  title: string
  question: string
  type: 'single' | 'multiple'
  options: AskOptionView[]
}

export const toolAskQuestions = (input: unknown): AskQuestionView[] => {
  const questions = (input as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(questions)) return []
  return questions.flatMap((q): AskQuestionView[] => {
    if (typeof q !== 'object' || q === null) return []
    const { title, question, type, options } = q as Record<string, unknown>
    if (typeof title !== 'string' || title.length === 0) return []
    const parsedType = type === 'multiple' ? 'multiple' : 'single'
    const parsedOptions = (Array.isArray(options) ? options : []).flatMap((o): AskOptionView[] => {
      if (typeof o !== 'object' || o === null) return []
      const { answer, answerDescription } = o as Record<string, unknown>
      if (typeof answer !== 'string' || answer.length === 0) return []
      return [{ answer, answerDescription: typeof answerDescription === 'string' && answerDescription.length > 0 ? answerDescription : undefined }]
    })
    if (parsedOptions.length === 0) return []
    return [{ title, question: typeof question === 'string' ? question : '', type: parsedType, options: parsedOptions }]
  })
}

export const flowOutputStatus = (part: ToolPartLike): string | undefined => {
  const output = part.output as { status?: unknown } | undefined
  return output !== null && typeof output === 'object' && typeof output.status === 'string' ? output.status : undefined
}

export const flowOutputMessage = (part: ToolPartLike): string => {
  const output = part.output as { message?: unknown } | undefined
  return output !== null && typeof output === 'object' && typeof output.message === 'string' ? output.message : ''
}

export type KnowledgeDetail = {
  kind: 'skill' | 'rule'
  name: string
  description: string
  file: string
  relatedFiles: number
}

export const knowledgeDetail = (part: ToolPartLike): KnowledgeDetail | undefined => {
  const name = rawToolName(part).toLowerCase()
  if (name !== 'skill' && name !== 'rule') return undefined
  const output = part.output
  if (typeof output !== 'object' || output === null) return undefined
  const record = output as Record<string, unknown>
  const description = typeof record.description === 'string' ? record.description : ''
  const file = (typeof record.skillFile === 'string' && record.skillFile) || (typeof record.ruleFile === 'string' && record.ruleFile) || ''
  const files = Array.isArray(record.files) ? record.files.length : 0
  const itemName = typeof record.name === 'string' && record.name.length > 0 ? record.name : summarizeToolInput(name, part.input) === '?' ? '' : summarizeToolInput(name, part.input)
  if (!itemName) return undefined
  return { kind: name, name: itemName, description, file, relatedFiles: files }
}

export const planText = (input: unknown): string | undefined => {
  const plan = (input as { plan?: unknown } | undefined)?.plan
  return typeof plan === 'string' && plan.length > 0 ? plan : undefined
}
