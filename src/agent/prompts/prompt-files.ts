import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { options } from '@config/options.ts'

export type PromptFileKind = 'agents' | 'workflows'

export interface PromptFileEntry {
  kind: PromptFileKind
  filename: string
  bundledUrl: URL
}

export type AgentPromptId = 'ask' | 'grill' | 'coder' | 'plan' | 'persistent' | 'optioneer'
export type SubagentPromptId = 'executor' | 'explorer' | 'reviewer' | 'debugger' | 'plan-reviewer'

export const AGENT_PROMPT_FILES: Record<AgentPromptId, PromptFileEntry> = {
  ask: { kind: 'agents', filename: 'ask.md', bundledUrl: new URL('./ask.md', import.meta.url) },
  grill: { kind: 'agents', filename: 'grill.md', bundledUrl: new URL('./grill.md', import.meta.url) },
  coder: { kind: 'agents', filename: 'coder.md', bundledUrl: new URL('./coder.md', import.meta.url) },
  plan: { kind: 'agents', filename: 'plan.md', bundledUrl: new URL('./plan.md', import.meta.url) },
  persistent: { kind: 'agents', filename: 'persistent.md', bundledUrl: new URL('./persistent.md', import.meta.url) },
  optioneer: { kind: 'agents', filename: 'optioneer.md', bundledUrl: new URL('./optioneer.md', import.meta.url) },
}

export const SUBAGENT_PROMPT_FILES: Record<SubagentPromptId, PromptFileEntry> = {
  executor: { kind: 'agents', filename: 'executor.md', bundledUrl: new URL('./executor.md', import.meta.url) },
  explorer: { kind: 'agents', filename: 'explorer.md', bundledUrl: new URL('./explorer.md', import.meta.url) },
  reviewer: { kind: 'agents', filename: 'reviewer.md', bundledUrl: new URL('./reviewer.md', import.meta.url) },
  debugger: { kind: 'agents', filename: 'debugger.md', bundledUrl: new URL('./debugger.md', import.meta.url) },
  'plan-reviewer': { kind: 'agents', filename: 'plan-reviewer.md', bundledUrl: new URL('./plan-reviewer.md', import.meta.url) },
}

export const ALL_PROMPT_FILES: Array<PromptFileEntry> = [...Object.values(AGENT_PROMPT_FILES), ...Object.values(SUBAGENT_PROMPT_FILES)]

export const promptFilePath = (entry: PromptFileEntry): string => join(options.app.systemDir, entry.kind, entry.filename)

export const readPromptMarkdown = (entry: PromptFileEntry): string => {
  const target = promptFilePath(entry)
  if (existsSync(target)) return readFileSync(target, 'utf8')
  return readFileSync(entry.bundledUrl, 'utf8')
}

export const seedPromptFiles = (entries: Array<PromptFileEntry>): Array<string> => {
  const written: Array<string> = []
  for (const entry of entries) {
    const target = promptFilePath(entry)
    if (existsSync(target)) continue
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(entry.bundledUrl, 'utf8'), 'utf8')
      written.push(target)
    } catch (error) {
      console.error(`picobu: failed to seed prompt ${entry.filename}:`, error)
    }
  }
  return written
}

export const overwritePromptFiles = (entries: Array<PromptFileEntry>): Array<string> => {
  const written: Array<string> = []
  for (const entry of entries) {
    const target = promptFilePath(entry)
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(entry.bundledUrl, 'utf8'), 'utf8')
      written.push(target)
    } catch (error) {
      console.error(`picobu: failed to overwrite prompt ${entry.filename}:`, error)
    }
  }
  return written
}
