import type { AgentReasoning } from '@agent/loop/create-loop.ts'
import { resolveModel } from '@agent/model/resolver.ts'
import { serializeForCompaction } from '@agent/sessions/session-compaction.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import type { UIMessage } from 'ai'
import { generateText } from 'ai'

export const summarizerPrompt = `Summarize the conversation below for a coding-agent session. Capture, in this order:
1. The user's goal and any decisions that were made.
2. The work completed: files changed, commands run, findings.
3. The current state: what exists now, what was verified.
4. Anything pending or unresolved (open questions, failed steps, next steps).
Be factual and concise; do not invent work that is not in the transcript.`
export type SummarizeParams = {
  messages: UIMessage[]
  modelKey: string
  thinking?: ProviderModelReasoningEffort
}
export type SummarizeResult = {
  summary: string
}

export async function summarizeSession({ messages, modelKey, thinking }: SummarizeParams): Promise<SummarizeResult> {
  const transcript = serializeForCompaction(messages)
  if (!transcript) throw new Error('Nothing to summarize: the session has no content')
  const { model } = resolveModel(modelKey)
  const { text } = await generateText({
    model,
    system: summarizerPrompt,
    prompt: transcript,
    ...(thinking !== undefined ? { reasoning: thinking as unknown as AgentReasoning } : {}),
  })
  const summary = text.trim()
  if (!summary) throw new Error('The model returned an empty summary')
  return { summary }
}
