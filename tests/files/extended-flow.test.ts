import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AskToolArgsSchema, createAskTool } from '../../src/agent/tools/flow/ask.ts'
import { createPlanExitTool, PlanExitToolArgsSchema } from '../../src/agent/tools/flow/plan-exit.ts'
import { createPlanWriteTool, PlanWriteToolArgsSchema } from '../../src/agent/tools/flow/plan-write.ts'
import { createRuleTool, RuleToolArgsSchema } from '../../src/agent/tools/flow/rule.ts'
import { createSkillTool, SkillToolArgsSchema } from '../../src/agent/tools/flow/skill.ts'
import { createSpawnTool, SpawnToolArgsSchema } from '../../src/agent/tools/flow/spawn.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const question = (title = 't') => ({ title, question: 'pick?', answerMode: 'single' as const, options: [{ answer: 'a', answerDescription: 'desc' }] })
describe('ask tool', () => {
  test('schema accepts one question and rejects empty or too many', () => {
    expect(AskToolArgsSchema.safeParse({ questions: [question()] }).success).toBe(true)
    expect(AskToolArgsSchema.safeParse({ questions: [{ title: 't', question: 'pick?', options: [{ answer: 'a' }] }] }).success).toBe(true)
    expect(AskToolArgsSchema.safeParse({ questions: [] }).success).toBe(false)
    expect(AskToolArgsSchema.safeParse({ questions: [question('1'), question('2'), question('3'), question('4'), question('5'), question('6')] }).success).toBe(false)
    expect(AskToolArgsSchema.safeParse({ questions: [{ title: '', question: '', answerMode: 'single', options: [] }] }).success).toBe(false)
  })
  test('handler returns pending with count', () => {
    const out = createAskTool().handler({ questions: [question(), question('u')] })
    expect(out.status).toBe('pending')
    expect(out.message).toContain('2 question')
  })
  test('handler rejects empty and oversized lists', () => {
    expect(() => createAskTool().handler({ questions: [] })).toThrow('at least one')
    expect(() => createAskTool().handler({ questions: [question('1'), question('2'), question('3'), question('4'), question('5'), question('6')] })).toThrow('at most 5')
  })
})
describe('plan tools', () => {
  test('plan-write schema requires non-empty plan', () => {
    expect(PlanWriteToolArgsSchema.safeParse({ plan: 'steps' }).success).toBe(true)
    expect(PlanWriteToolArgsSchema.safeParse({ plan: '' }).success).toBe(false)
    expect(PlanWriteToolArgsSchema.safeParse({}).success).toBe(false)
  })
  test('plan-write handler counts lines', () => {
    const one = createPlanWriteTool().handler({ plan: 'only' })
    expect(one.status).toBe('pending')
    expect(one.message).toContain('1 lines')
    const two = createPlanWriteTool().handler({ plan: 'a\nb\nc' })
    expect(two.message).toContain('3 lines')
  })
  test('plan-exit schema and handler hand off to coder', () => {
    expect(PlanExitToolArgsSchema.safeParse({}).success).toBe(true)
    const out = createPlanExitTool().handler()
    expect(out.switchedTo).toBe('coder')
    expect(out.message).toContain('Plan approved')
  })
})
describe('skill and rule tools with tmp', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-flow-'))
    initLockDir(join(dir, 'locks'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('skill schema requires name', () => {
    expect(SkillToolArgsSchema.safeParse({ name: 'x' }).success).toBe(true)
    expect(SkillToolArgsSchema.safeParse({}).success).toBe(false)
  })
  test('skill handler loads content case-insensitively', async () => {
    const skillDir = join(dir, 'myskill')
    await mkdir(skillDir, { recursive: true })
    await Bun.write(join(skillDir, 'SKILL.md'), '---\nname: my-skill\n---\nHello skill body\n')
    await Bun.write(join(skillDir, 'extra.txt'), 'extra')
    const tool = createSkillTool(() => [{ kind: 'skill' as const, name: 'my-skill', aliases: [], title: 't', description: 'desc', path: join(skillDir, 'SKILL.md') }])
    const got = await tool.handler({ name: '  MY-SKILL ' })
    expect(got.name).toBe('my-skill')
    expect(got.skillDir).toBe(skillDir)
    expect(got.files).toEqual(['SKILL.md', 'extra.txt'])
    expect(got.content).toContain('Hello skill body')
  })
  test('skill handler reports unknown names', async () => {
    const tool = createSkillTool(() => [])
    await expect(tool.handler({ name: 'nope' })).rejects.toThrow('Unknown skill')
  })
  test('rule schema requires name', () => {
    expect(RuleToolArgsSchema.safeParse({ name: 'x' }).success).toBe(true)
    expect(RuleToolArgsSchema.safeParse({}).success).toBe(false)
  })
  test('rule handler loads content and reports unknown', async () => {
    const ruleDir = join(dir, 'rules')
    await mkdir(ruleDir, { recursive: true })
    await Bun.write(join(ruleDir, 'myrule.md'), '---\ndescription: does things\n---\nRule body here\n')
    const tool = createRuleTool(() => [{ name: 'myrule', description: 'does things', path: join(ruleDir, 'myrule.md') }])
    const got = await tool.handler({ name: 'MYRULE' })
    expect(got.name).toBe('myrule')
    expect(got.content).toContain('Rule body here')
    await expect(tool.handler({ name: 'missing' })).rejects.toThrow('Unknown rule')
  })
})
describe('spawn tool', () => {
  test('schema requires subagent and prompt', () => {
    expect(SpawnToolArgsSchema.safeParse({ subagent: 'coder', prompt: 'do it' }).success).toBe(true)
    expect(SpawnToolArgsSchema.safeParse({ subagent: '', prompt: '' }).success).toBe(false)
    expect(SpawnToolArgsSchema.safeParse({ subagent: 'coder' }).success).toBe(false)
  })
  test('handler delegates to manager and returns summary', async () => {
    const fake = {
      spawnSubSession: async (input: { prompt: string }) => ({
        summary: `done:${input.prompt}`,
      }),
    }
    const tool = createSpawnTool({ manager: fake as never, parentId: 'p', depth: 0 })
    const got = await tool.handler({ subagent: 'coder', prompt: 'hi' })
    expect(got.summary).toBe('done:hi')
  })
})
