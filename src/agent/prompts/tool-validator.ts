import type { AgentReasoning } from '@agent/loop/create-loop.ts'
import { resolveModel } from '@agent/model/resolver.ts'
import { options, resolveModelRole } from '@config/options.ts'
import { generateObject, type ModelMessage } from 'ai'
import { z } from 'zod'

export const toolValidatorPrompt = [
  'You are a strict tool-execution validator for a coding agent.',
  'Decide whether the requested tool call is safe, well-formed and appropriate to execute now.',
  'Respond only with a JSON object of the shape {"approved": boolean, "reason": string}.',
  'Set "approved" to true when the tool call may execute.',
  'Set "approved" to false and put a one-line explanation in "reason" when it must not execute.',
].join('\n')

export const validatorSchema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
})

const MAX_CONTEXT_CHARS = 2000
const VALIDATOR_TIMEOUT_MS = 30000

export interface ToolValidatorContext {
  userRequest?: string
  assistantMessage?: string
  assistantThinking?: string
  lastToolCall?: string
}

export interface ToolValidatorInput extends ToolValidatorContext {
  toolName: string
  input: unknown
  sessionId?: string
}

export interface ToolValidatorResult {
  approved: boolean
  reason?: string
}

const cap = (value: string): string => value.trim().slice(0, MAX_CONTEXT_CHARS)

const textOf = (content: string | Array<unknown>): string | undefined => {
  if (typeof content === 'string') return cap(content) || undefined
  const parts: Array<string> = []
  for (const part of content) {
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
  }
  const joined = cap(parts.join('\n'))
  return joined || undefined
}

const reasoningOf = (content: Array<unknown>): string | undefined => {
  const parts: Array<string> = []
  for (const part of content) {
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'reasoning' && typeof p.text === 'string') parts.push(p.text)
  }
  const joined = cap(parts.join('\n'))
  return joined || undefined
}

const toolCallOf = (content: Array<unknown>): string | undefined => {
  for (let i = content.length - 1; i >= 0; i--) {
    const p = content[i] as { type?: unknown; toolName?: unknown; input?: unknown }
    if (p.type === 'tool-call' && typeof p.toolName === 'string') return cap(`${p.toolName} ${JSON.stringify(p.input)}`) || undefined
  }
  return undefined
}

export const extractValidatorContext = (messages: Array<ModelMessage>): ToolValidatorContext => {
  let lastUser: string | undefined
  let lastAssistant: string | undefined
  let lastThinking: string | undefined
  let lastTool: string | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      const text = textOf(message.content as string | Array<unknown>)
      if (text) lastUser = text
    }
    if (message.role === 'assistant') {
      const content = message.content as string | Array<unknown>
      const text = textOf(content)
      if (text) lastAssistant = text
      if (Array.isArray(content)) {
        const thinking = reasoningOf(content)
        if (thinking) lastThinking = thinking
        const tool = toolCallOf(content)
        if (tool) lastTool = tool
      }
    }
  }
  return {
    ...(lastUser ? { userRequest: lastUser } : {}),
    ...(lastAssistant ? { assistantMessage: lastAssistant } : {}),
    ...(lastThinking ? { assistantThinking: lastThinking } : {}),
    ...(lastTool ? { lastToolCall: lastTool } : {}),
  }
}

export const buildToolValidatorPrompt = (input: ToolValidatorInput): string => {
  const sections = [toolValidatorPrompt]
  if (input.userRequest) sections.push('', 'User request:', cap(input.userRequest))
  if (input.assistantMessage) sections.push('', 'Last assistant message:', cap(input.assistantMessage))
  if (input.assistantThinking) sections.push('', 'Last assistant thinking:', cap(input.assistantThinking))
  if (input.lastToolCall) sections.push('', 'Last tool request:', cap(input.lastToolCall))
  sections.push('', 'Tool call to validate:', `${input.toolName} ${JSON.stringify(input.input)}`)
  return sections.join('\n')
}

export async function validateToolCall(input: ToolValidatorInput): Promise<ToolValidatorResult> {
  try {
    const { modelKey } = resolveModelRole(options.harness, 'tiny')
    const { model } = resolveModel(modelKey, input.sessionId ? { sessionId: input.sessionId } : undefined)
    const { object } = await generateObject({
      model,
      schema: validatorSchema,
      reasoning: 'none' satisfies AgentReasoning,
      abortSignal: AbortSignal.timeout(VALIDATOR_TIMEOUT_MS),
      prompt: buildToolValidatorPrompt(input),
    })
    if (object.approved) return { approved: true }
    return { approved: false, reason: object.reason?.trim() || 'Tool call denied by the auto-pilot validator.' }
  } catch (error) {
    return { approved: false, reason: `Auto-pilot validator failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
