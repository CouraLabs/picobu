import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createAgent, NO_TOOLS } from '@agent/agents/create-agent.ts'
import type { AgentType } from '@agent/agents/types.ts'
import { parseMarkdownFile } from '@agent/markdown/markdown-parser.ts'
import { readPromptMarkdown, SUBAGENT_PROMPT_FILES } from '@agent/prompts/prompt-files.ts'
import { options } from '@config/options.ts'

export const INTERACTIVE_FLOW_TOOLS: ReadonlyArray<string> = ['ask', 'plan-write', 'plan-exit']

export const WRITE_CAPABLE_TOOLS: ReadonlyArray<string> = ['write', 'edit', 'apply_patch']

export const canWriteFiles = (tools: Array<string>): boolean => {
  if (tools.length === 0) return true
  if (tools.includes(NO_TOOLS)) return false
  return tools.some((t) => WRITE_CAPABLE_TOOLS.includes(t))
}

export const SUBAGENT_DEPTH_CAP = 3

export const SUBAGENT_RULES = `## Subagent Rules
- You are a subagent with no user interaction: never ask, wait, or submit plans. Resolve ambiguity yourself and state assumptions.
- Context isolation: work only from the prompt you were given. You have no access to the caller's session history — do not ask for or assume it.
- Finish with a self-contained summary as your last text message: what you did, found/changed, and what the caller should know. Never end on a bare tool call.
- Report contract: lead with a status line — DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED — followed by what changed and the evidence (commands run, results observed). A claim of success without evidence is not a report.`

export const BUILT_IN_SUBAGENTS: Record<string, AgentType> = {
  executor: createAgent(readPromptMarkdown(SUBAGENT_PROMPT_FILES.executor)),
  explorer: createAgent(readPromptMarkdown(SUBAGENT_PROMPT_FILES.explorer)),
  reviewer: createAgent(readPromptMarkdown(SUBAGENT_PROMPT_FILES.reviewer)),
  debugger: createAgent(readPromptMarkdown(SUBAGENT_PROMPT_FILES.debugger)),
}

const subagentsDir = (cwd: string): string => join(cwd, '.agents', 'agents')

const parseSubagentTools = (value: unknown): Array<string> => {
  if (typeof value !== 'string') return []
  if (value.trim().toLowerCase() === 'none') return [NO_TOOLS]
  if (value.trim() === '' || value.trim() === '*') return []
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export async function listSubagents(cwd: string = options.app.cwd): Promise<Array<AgentType>> {
  const byName = new Map<string, AgentType>()
  for (const def of Object.values(BUILT_IN_SUBAGENTS)) byName.set(def.name.toLowerCase(), def)
  let files: Array<string>
  try {
    files = (await readdir(subagentsDir(cwd))).filter((f) => f.endsWith('.md'))
  } catch {
    return [...byName.values()]
  }
  for (const file of files) {
    try {
      const parsed = await parseMarkdownFile(join(subagentsDir(cwd), file))
      const name = typeof parsed.name === 'string' ? parsed.name : ''
      if (!name) continue
      byName.set(name.toLowerCase(), {
        name,
        description: typeof parsed.description === 'string' ? parsed.description : '',
        category: 'coding',
        tools: parseSubagentTools(parsed.tools),
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        prompt: parsed.content,
      })
    } catch (error) {
      console.error(`picobu: failed to load subagent ${file}:`, error)
    }
  }
  return [...byName.values()]
}

export async function getSubagent(name: string, cwd: string = options.app.cwd): Promise<AgentType | undefined> {
  return (await listSubagents(cwd)).find((s) => s.name.toLowerCase() === name.toLowerCase())
}

export function prepareSubagent(def: AgentType): AgentType {
  if (def.tools.includes(NO_TOOLS)) {
    return {
      ...def,
      tools: [NO_TOOLS],
      prompt: `${def.prompt.trim()}\n\n${SUBAGENT_RULES}`,
    }
  }
  const tools = def.tools.filter((t) => !INTERACTIVE_FLOW_TOOLS.includes(t))
  return {
    ...def,
    tools: def.tools.length > 0 && tools.length === 0 ? [NO_TOOLS] : tools,
    prompt: `${def.prompt.trim()}\n\n${SUBAGENT_RULES}`,
  }
}
