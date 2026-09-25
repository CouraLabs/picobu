import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('../..', import.meta.url)))

const boot = (payload: string): { ok: boolean; error?: string } => {
  const systemDir = mkdtempSync(join(tmpdir(), 'picobu-boot-'))
  const proc = Bun.spawnSync([process.execPath, join(root, 'tests', 'config', 'options-boot-check.ts'), Buffer.from(payload, 'utf8').toString('base64')], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PICOBU_REAL_OPTIONS: '1', PICOBU_SYSTEM_DIR: systemDir },
  })
  const line = proc.stdout.toString().trim().split('\n').pop() ?? ''
  return JSON.parse(line) as { ok: boolean; error?: string }
}

describe('options boot validation', () => {
  test('fails to boot on a schema-invalid options.json', () => {
    const result = boot(JSON.stringify({ harness: { budgetLimitUsd: -1 } }))
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toContain('harness.budgetLimitUsd')
  })

  test('boots on a valid options.json', () => {
    const result = boot(JSON.stringify({ harness: { defaultModel: 'openai/gpt', budgetLimitUsd: 5 } }))
    expect(result.ok).toBe(true)
  })

  test('boots with documented MCP servers (id from key, type inferred)', () => {
    const result = boot(JSON.stringify({ mcp: { servers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' }, fs: { command: 'npx', args: ['-y', 'fs-mcp'] } } } }))
    expect(result.ok).toBe(true)
  })
})
