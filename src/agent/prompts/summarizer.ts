import type { AgentReasoning } from '@agent/loop/create-loop.ts'
import { resolveModel } from '@agent/model/resolver.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import type { UIMessage } from 'ai'
import { generateText } from 'ai'

const MAX_TOOL_CHARS = 200
const abbreviate = (value: unknown): string => {
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_TOOL_CHARS ? `${flat.slice(0, MAX_TOOL_CHARS)}…` : flat
}
interface LoosePart {
  type: string
  text?: unknown
  state?: unknown
  toolName?: unknown
  input?: unknown
  output?: unknown
  errorText?: unknown
}
const isToolPart = (part: LoosePart): boolean => part.type === 'dynamic-tool' || part.type.startsWith('tool-')
const toolPartName = (part: LoosePart): string => (part.type === 'dynamic-tool' ? String(part.toolName ?? 'unknown') : part.type.slice('tool-'.length))

const serializeForSummary = (messages: Array<UIMessage>): string =>
  messages
    .flatMap((m) => {
      if (m.role !== 'user' && m.role !== 'assistant') return []
      const lines = (m.parts as Array<LoosePart>).flatMap((part): Array<string> => {
        if (part.type === 'text') {
          const text = typeof part.text === 'string' ? part.text.trim() : ''
          return text ? [`${m.role}: ${text}`] : []
        }
        if (part.type === 'reasoning') return []
        if (isToolPart(part)) {
          return [`tool ${toolPartName(part)} (${String(part.state ?? 'unknown')}): ${abbreviate(part.input)} -> ${abbreviate(part.output ?? part.errorText)}`]
        }
        return []
      })
      return lines
    })
    .join('\n')

export const summarizerPrompt = `Summarize the conversation below for a coding-agent session. Capture, in this order:
1. The user's goal and any decisions that were made.
2. The work completed: files changed, commands run, findings.
3. The current state: what exists now, what was verified.
4. Anything pending or unresolved (open questions, failed steps, next steps).
Be factual and concise; do not invent work that is not in the transcript.`
export interface SummarizeParams {
  messages: Array<UIMessage>
  modelKey: string
  thinking?: ProviderModelReasoningEffort
}
export interface SummarizeResult {
  summary: string
}

export async function summarizeSession({ messages, modelKey, thinking }: SummarizeParams): Promise<SummarizeResult> {
  const transcript = serializeForSummary(messages)
  if (!transcript) throw new Error('Nothing to summarize: the session has no content')
  const { model } = resolveModel(modelKey)
  const { text } = await generateText({
    model,
    system: summarizerPrompt,
    prompt: transcript,
    ...(thinking !== undefined ? { reasoning: thinking as AgentReasoning } : {}),
  })
  const summary = text.trim()
  if (!summary) throw new Error('The model returned an empty summary')
  return { summary }
}
