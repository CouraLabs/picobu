import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function loadAgentsMarkdown(cwd: string): Promise<string | undefined> {
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    try {
      const content = await readFile(join(cwd, name), 'utf8')
      if (!content.trim()) continue
      return content.length > 2000 ? `${content.slice(0, 2000)}\n…[truncated, read the file for the rest]` : content
    } catch {}
  }
  return undefined
}
