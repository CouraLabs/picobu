import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { options } from '@config/options.ts'

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'server'

const opened = new Map<string, number | 'ignore'>()

export const closeMcpStderrTargets = (): void => {
  for (const [id, target] of opened) {
    if (typeof target === 'number') {
      try {
        closeSync(target)
      } catch {}
    }
    opened.delete(id)
  }
}

export const createMcpStderrTarget = (serverId: string): number | 'ignore' => {
  const cached = opened.get(serverId)
  if (cached !== undefined) return cached
  let target: number | 'ignore'
  try {
    const dir = join(options.app.systemDir, 'mcp-stderr')
    mkdirSync(dir, { recursive: true })
    target = openSync(join(dir, `${sanitize(serverId)}.log`), 'a')
  } catch {
    target = 'ignore'
  }
  opened.set(serverId, target)
  return target
}
