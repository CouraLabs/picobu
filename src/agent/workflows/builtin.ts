import type { Command } from '@agent/commands/types.ts'
import { parseMarkdown } from '@agent/markdown/markdown-parser.ts'
import { type PromptFileEntry, readPromptMarkdown } from '@agent/prompts/prompt-files.ts'

export type WorkflowPromptId = 'init' | 'review'

export const WORKFLOW_PROMPT_FILES: Record<WorkflowPromptId, PromptFileEntry> = {
  init: { kind: 'workflows', filename: 'init.md', bundledUrl: new URL('./init.md', import.meta.url) },
  review: { kind: 'workflows', filename: 'review.md', bundledUrl: new URL('./review.md', import.meta.url) },
}

const loadBuiltin = (entry: PromptFileEntry, fallbackName: string): Command | undefined => {
  try {
    const raw = readPromptMarkdown(entry)
    const parsed = parseMarkdown(raw)
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallbackName
    const description = typeof parsed.description === 'string' ? parsed.description : ''
    if (!description.trim()) return undefined
    return { kind: 'workflow', name, aliases: [], title: name, description, path: '', content: raw }
  } catch {
    return undefined
  }
}

export const BUILTIN_WORKFLOWS: Array<Command> = [loadBuiltin(WORKFLOW_PROMPT_FILES.init, 'init'), loadBuiltin(WORKFLOW_PROMPT_FILES.review, 'review')].filter((c): c is Command => c !== undefined)
