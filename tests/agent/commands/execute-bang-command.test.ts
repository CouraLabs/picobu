import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeBangCommand } from '../../../src/agent/commands/execute-bang-command.ts'

describe('executeBangCommand', () => {
  it('empty command throws with usage message', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'picobu-bang-'))
    try {
      await expect(executeBangCommand('   ', tmpDir)).rejects.toThrow('Usage: !<command>')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('successful command returns exit code 0 and stdout', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'picobu-bang-'))
    try {
      const result = await executeBangCommand('echo hello', tmpDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
      expect(result.stderr).toBe('')
      expect(result.truncated).toBe(false)
      expect(result.outputPath).toBeUndefined()
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('non-zero exit preserves exit code', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'picobu-bang-'))
    try {
      const result = await executeBangCommand('exit 7', tmpDir)
      expect(result.exitCode).toBe(7)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('command not found resolves with non-zero exit and stderr', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'picobu-bang-'))
    try {
      const result = await executeBangCommand('this-binary-truly-does-not-exist-xyz123', tmpDir)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.length).toBeGreaterThan(0)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('cwd is respected', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'picobu-bang-'))
    try {
      const subdir = join(tmpDir, 'subdir')
      await mkdir(subdir)
      const result = await executeBangCommand('pwd', subdir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe(await realpath(subdir))
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('large output is truncated with spill file', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'picobu-bang-'))
    let outputPath: string | undefined
    try {
      const result = await executeBangCommand('seq 1 50000', tmpDir)
      outputPath = result.outputPath
      expect(result.truncated).toBe(true)
      expect(result.outputPath).toBeDefined()
      expect(outputPath === undefined ? 0 : (await readFile(outputPath, 'utf8')).length).toBeGreaterThan(0)
      expect(result.stdout).toContain('truncated')
      expect(result.stdout).toContain('Full output saved to:')
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
      if (outputPath) await rm(outputPath, { force: true })
    }
  })
})
