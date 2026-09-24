import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_PROMPT_FILES, ALL_PROMPT_FILES, overwritePromptFiles, promptFilePath, readPromptMarkdown, SUBAGENT_PROMPT_FILES, seedPromptFiles } from '../../src/agent/prompts/prompt-files.ts'
import { options } from '../../src/config/options.ts'

const originalSystemDir = options.app.systemDir

describe('prompt-files', () => {
  test('seeds a home copy of each prompt and reads home-first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'picobu-prompts-'))
    options.app.systemDir = dir
    try {
      const written = seedPromptFiles(ALL_PROMPT_FILES)
      const askTarget = promptFilePath(AGENT_PROMPT_FILES.ask)
      expect(written).toContain(askTarget)
      expect(await readFile(askTarget, 'utf8')).toContain('name: Ask')
      expect(seedPromptFiles(ALL_PROMPT_FILES)).toEqual([])
      expect(readPromptMarkdown(SUBAGENT_PROMPT_FILES.explorer)).toContain('name: Explorer')
      await writeFile(askTarget, 'CUSTOM', 'utf8')
      expect(readPromptMarkdown(AGENT_PROMPT_FILES.ask)).toBe('CUSTOM')
      await rm(askTarget)
      expect(readPromptMarkdown(AGENT_PROMPT_FILES.ask)).toContain('name: Ask')
    } finally {
      options.app.systemDir = originalSystemDir
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('overwritePromptFiles always rewrites every entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'picobu-prompts-overwrite-'))
    options.app.systemDir = dir
    try {
      seedPromptFiles(ALL_PROMPT_FILES)
      const askTarget = promptFilePath(AGENT_PROMPT_FILES.ask)
      await writeFile(askTarget, 'CUSTOM', 'utf8')
      expect(readPromptMarkdown(AGENT_PROMPT_FILES.ask)).toBe('CUSTOM')
      const written = overwritePromptFiles(ALL_PROMPT_FILES)
      expect(written).toContain(askTarget)
      expect(readPromptMarkdown(AGENT_PROMPT_FILES.ask)).toContain('name: Ask')
      expect(overwritePromptFiles(ALL_PROMPT_FILES)).toContain(askTarget)
    } finally {
      options.app.systemDir = originalSystemDir
      await rm(dir, { recursive: true, force: true })
    }
  })
})
