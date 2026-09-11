import { type MarkdownParam, parseMarkdown } from '@agent/markdown/markdown-parser.ts'
export const systemMarkdown = `# System Preamble
You are {APP_NAME}, a general-purpose coding agent. Adapt to the task. Prefer real progress over approval.
# Communication Style
Be concise and direct: lead with the result, skip filler and pleasantries. Expand only when detail changes what the user does next.
# System Environment
- Working directory: {APP_CWD}
- Operating system: {APP_OS}
- System Shell: {APP_SHELL}
# System Guidelines
- Act on repo context instead of asking for confirmation.
- Resolve ambiguity from conventions and reasonable defaults; escalate only on materially different tradeoffs.
- Mark unobserved claims [INFERENCE].
- Reply in the user's language, regardless of code or prompt language.`
export interface SystemPromptSection {
  key: string
  content: string
}
export interface GenerateSystemMessageParams {
  appName: string
  cwd: string
  os: string
  shell: string
  agentPrompt?: string
  toolsInfo?: string
  skillsInfo?: string
  rulesInfo?: string
  subagentsInfo?: string
  agentsAppendix?: string
}

const MAX_DESC_CHARS = 150
const MAX_APPENDIX_CHARS = 2000

const shortDesc = (value: string): string => {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_DESC_CHARS ? `${oneLine.slice(0, MAX_DESC_CHARS - 1)}…` : oneLine
}

export function buildSkillsSection(skills: Array<{ name: string; description: string }>): string {
  return ['Call the `skill` tool with the exact name to load instructions, then follow them.', '', ...skills.map((s) => `- ${s.name}: ${shortDesc(s.description)}`)].join('\n')
}

export function buildSubagentsSection(subagents: Array<{ name: string; description: string }>, maxAgents: number): string {
  return [
    `Call \`spawn\` with the exact name and a self-contained prompt (subagents can't ask questions).` +
      (maxAgents > 0 ? ` Up to ${maxAgents} in parallel.` : ' Spawning is disabled (maxAgents is 0).'),
    '',
    ...subagents.map((s) => `- ${s.name}: ${shortDesc(s.description)}`),
  ].join('\n')
}

export function buildRulesSection(rules: Array<{ name: string; description: string }>): string {
  return ['Call the `rule` tool with the exact name to load instructions, then follow them.', '', ...rules.map((r) => `- ${r.name}: ${shortDesc(r.description)}`)].join('\n')
}

export function generateSystemMessage(params: GenerateSystemMessageParams): Array<SystemPromptSection> {
  const paramsList: Array<MarkdownParam> = [
    { param: '{APP_NAME}', value: params.appName },
    { param: '{APP_CWD}', value: params.cwd },
    { param: '{APP_OS}', value: params.os },
    { param: '{APP_SHELL}', value: params.shell },
  ]
  const { content } = parseMarkdown(systemMarkdown, paramsList)
  const sections = splitIntoSections(content)
  if (params.agentsAppendix) {
    const appendix = params.agentsAppendix.length > MAX_APPENDIX_CHARS ? `${params.agentsAppendix.slice(0, MAX_APPENDIX_CHARS)}\n…[truncated, read the file for the rest]` : params.agentsAppendix
    for (const section of sections) {
      if (section.key === 'System Guidelines') section.content += `\n\n${appendix}`
    }
  }
  if (params.agentPrompt) {
    sections.push({ key: 'Agent Role', content: params.agentPrompt })
  }
  if (params.skillsInfo) {
    sections.push({ key: 'Skills', content: params.skillsInfo })
  }
  if (params.rulesInfo) {
    sections.push({ key: 'Rules', content: params.rulesInfo })
  }
  if (params.subagentsInfo) {
    sections.push({ key: 'Subagents', content: params.subagentsInfo })
  }
  if (params.toolsInfo) {
    sections.push({ key: 'Available Tools', content: params.toolsInfo })
  }
  return sections
}
function splitIntoSections(content: string): Array<SystemPromptSection> {
  const sections: Array<SystemPromptSection> = []
  let current: SystemPromptSection | null = null
  for (const line of content.split('\n')) {
    const heading = /^#\s+(.+)$/.exec(line)
    if (heading) {
      if (current) sections.push(current)
      const key = heading[1]
      if (!key) continue
      current = { key: key.trim(), content: '' }
      continue
    }
    if (current) current.content += current.content.length ? `\n${line}` : line
  }
  if (current) sections.push(current)
  return sections
}
