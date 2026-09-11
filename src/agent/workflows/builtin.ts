import { readFileSync } from 'node:fs'
import type { Command } from '@agent/commands/types.ts'
import { parseMarkdown } from '@agent/markdown/markdown-parser.ts'

const loadBuiltin = (file: string): Command | undefined => {
  try {
    const raw = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    const parsed = parseMarkdown(raw)
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : file.replace(/\.md$/, '')
    const description = typeof parsed.description === 'string' ? parsed.description : ''
    if (!description.trim()) return undefined
    return { kind: 'workflow', name, aliases: [], title: name, description, path: '', content: raw }
  } catch {
    return undefined
  }
}

export const BUILTIN_WORKFLOWS: Array<Command> = [loadBuiltin('init.md')].filter((c): c is Command => c !== undefined)
