import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LEGACY_LLM_AUTH_FILE, removeLegacyLlmAuthFile } from '../../src/config/legacy-auth-cleanup.ts'

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'picobu-legacy-auth-'))

describe('removeLegacyLlmAuthFile', () => {
  test('deletes a legacy auth.json and reports true', () => {
    const dir = tempDir()
    try {
      const path = join(dir, LEGACY_LLM_AUTH_FILE)
      writeFileSync(path, '{"openai":{"type":"oauth"}}')
      expect(removeLegacyLlmAuthFile(dir)).toBe(true)
      expect(existsSync(path)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('is idempotent when the file is already gone', () => {
    const dir = tempDir()
    try {
      expect(removeLegacyLlmAuthFile(dir)).toBe(false)
      expect(removeLegacyLlmAuthFile(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('leaves mcp-auth.json untouched', () => {
    const dir = tempDir()
    try {
      const mcpPath = join(dir, 'mcp-auth.json')
      writeFileSync(mcpPath, '{"linear":{"tokens":{}}}')
      removeLegacyLlmAuthFile(dir)
      expect(existsSync(mcpPath)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
