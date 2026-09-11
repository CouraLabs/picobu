import { describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'
import { createAgent, NO_TOOLS } from '../../src/agent/agents/create-agent.ts'
import { AGENTS, DEFAULT_AGENT_ID, getAgent, getDefaultAgent, listAgents } from '../../src/agent/agents/registry.ts'
import { BUILT_IN_SUBAGENTS, getSubagent, INTERACTIVE_FLOW_TOOLS, listSubagents, prepareSubagent, SUBAGENT_DEPTH_CAP, SUBAGENT_RULES } from '../../src/agent/agents/subagents.ts'
import { buildCommandPrompt, loadCommandCatalog, loadCommandCatalogSync } from '../../src/agent/commands/discovery.ts'
import type { Command } from '../../src/agent/commands/types.ts'
import { hyper } from '../../src/agent/model/catalog-hyper.ts'
import { fetchModelsDevProvider, modelsFromModelsDev } from '../../src/agent/model/catalog-models-dev.ts'
import { parseModelsResponse } from '../../src/agent/model/fetch-models.ts'
import { LLM_PROVIDERS, upsertProvider } from '../../src/agent/model/registry.ts'
import { createModelInstance, listModels, resolveApiKey, resolveAuth } from '../../src/agent/model/resolver.ts'
import { loadAgentsMarkdown } from '../../src/agent/prompts/agents-md.ts'
import { askMarkdown } from '../../src/agent/prompts/ask.ts'
import { coderMarkdown } from '../../src/agent/prompts/coder.ts'
import { compactorPrompt } from '../../src/agent/prompts/compactor.ts'
import { bytesToDataUrl, countLines, fileEmbedLabel, resolvePrompt, textEmbedLabel } from '../../src/agent/prompts/embeds.ts'
import { persistentMarkdown } from '../../src/agent/prompts/persistent.ts'
import { planMarkdown } from '../../src/agent/prompts/plan.ts'
import { buildTitlePrompt, generateSessionTitle, sessionTitlePrompt } from '../../src/agent/prompts/session-title.ts'
import { summarizerPrompt } from '../../src/agent/prompts/summarizer.ts'
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage, systemMarkdown } from '../../src/agent/prompts/system.ts'
import { listRules, loadRules } from '../../src/agent/rules/rules.ts'
import { options, type ProviderOptions } from '../../src/config/options.ts'

mock.module('@opencode-ai/models', () => ({
  Models: {
    make: () => ({
      providers: async (): Promise<unknown> => ({
        demo: { id: 'demo', name: 'Demo', env: ['PICOBU_TEST_ENV_MATCH'], models: {} },
      }),
    }),
  },
}))

const makeTempRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), 'picobu-extended-'))

const putFile = async (root: string, rel: string, text: string): Promise<string> => {
  const full = join(root, rel)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, text)
  return full
}

describe('createAgent', () => {
  test('none tools are case-insensitive', () => {
    expect(createAgent('---\ntools: None\n---\nbody').tools).toEqual([NO_TOOLS])
    expect(createAgent('---\ntools: NONE\n---\nbody').tools).toEqual([NO_TOOLS])
    expect(createAgent('---\ntools:   none  \n---\nbody').tools).toEqual([NO_TOOLS])
  })
  test('star and missing tools yield empty list', () => {
    expect(createAgent('---\ntools: *\n---\nbody').tools).toEqual([])
    expect(createAgent('---\nname: X\n---\nbody').tools).toEqual([])
    expect(createAgent('---\ntools:\n---\nbody').tools).toEqual([])
  })
  test('splits and trims tool lists', () => {
    expect(createAgent('---\ntools: read, write,,  shell \n---\nbody').tools).toEqual(['read', 'write', 'shell'])
  })
  test('numeric-looking names stay strings with defaults', () => {
    const agent = createAgent('---\nname: 123\n---\nbody')
    expect(agent.name).toBe('123')
    expect(agent.description).toBe('')
    expect(agent.model).toBeUndefined()
    expect(agent.color).toBeUndefined()
    expect(agent.prompt).toBe('body')
  })
  test('blank name falls back to agent', () => {
    expect(createAgent('---\nname:   \n---\nbody').name).toBe('agent')
    expect(createAgent('plain body').name).toBe('agent')
  })
  test('category is persistent only on exact match', () => {
    expect(createAgent('---\ncategory: persistent\n---\nb').category).toBe('persistent')
    expect(createAgent('---\ncategory: Persistent\n---\nb').category).toBe('persistent')
    expect(createAgent('---\ncategory: 123\n---\nb').category).toBe('coding')
    expect(createAgent('---\nname: X\n---\nb').category).toBe('coding')
  })
  test('model and color pass through', () => {
    const agent = createAgent('---\nmodel: m1\ncolor: red\n---\nb')
    expect(agent.model).toBe('m1')
    expect(agent.color).toBe('red')
  })
})

describe('agent registry', () => {
  test('getAgent throws unknown with known list', () => {
    let message = ''
    try {
      getAgent('missing-agent')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('Unknown agent "missing-agent"')
    expect(message).toContain('ask')
    expect(message).toContain('coder')
  })
  test('getAgent returns registered agents', () => {
    expect(getAgent('ask').name).toBe('Ask')
    expect(getAgent('plan-code').name).toBe('Plan')
  })
  test('default agent matches default id', () => {
    expect(getDefaultAgent()).toBe(getAgent(DEFAULT_AGENT_ID))
  })
  test('listAgents filters by category', () => {
    expect(listAgents().length).toBe(Object.keys(AGENTS).length)
    expect(listAgents('coding').every((a) => a.category === 'coding')).toBe(true)
    expect(listAgents('persistent').map((a) => a.id)).toContain('persistent')
  })
})

describe('subagents', () => {
  test('sentinels survive prepareSubagent', () => {
    const base = { name: 'T', description: 'D', category: 'coding' as const, tools: ['read', 'ask'], prompt: 'Do work' }
    const prepared = prepareSubagent(base)
    expect(prepared.tools).toEqual(['read'])
    expect(prepared.prompt).toContain('Do work')
    expect(prepared.prompt).toContain(SUBAGENT_RULES)
    expect(prepareSubagent({ ...base, tools: [NO_TOOLS] }).tools).toEqual([NO_TOOLS])
    expect(prepareSubagent({ ...base, tools: ['ask', 'plan-write'] }).tools).toEqual([NO_TOOLS])
    expect(prepareSubagent({ ...base, tools: [] }).tools).toEqual([])
  })
  test('interactive flow tools are known', () => {
    expect(INTERACTIVE_FLOW_TOOLS).toContain('ask')
    expect(SUBAGENT_DEPTH_CAP).toBe(3)
    expect(SUBAGENT_RULES.length).toBeGreaterThan(0)
    expect(SUBAGENT_RULES).toContain('subagent')
    expect(Object.keys(BUILT_IN_SUBAGENTS).sort()).toEqual(['executor', 'explorer', 'reviewer'])
  })
  test('listSubagents reads custom files with none and star sentinels', async () => {
    const root = await makeTempRoot()
    await putFile(root, join('.agents', 'agents', 'helper.md'), '---\nname: Helper\ndescription: Helps out\ntools: read\n---\nHelper body\n')
    await putFile(root, join('.agents', 'agents', 'quiet.md'), '---\nname: Quiet\ndescription: Says nothing\ntools: none\n---\nQuiet body\n')
    await putFile(root, join('.agents', 'agents', 'star.md'), '---\nname: Star\ndescription: Star tools\ntools: *\n---\nStar body\n')
    await putFile(root, join('.agents', 'agents', 'nameless.md'), '---\ndescription: No name here\n---\nBody\n')
    const subs = await listSubagents(root)
    expect(subs.find((s) => s.name === 'Helper')?.tools).toEqual(['read'])
    expect(subs.find((s) => s.name === 'Quiet')?.tools).toEqual([NO_TOOLS])
    expect(subs.find((s) => s.name === 'Star')?.tools).toEqual([])
    expect(subs.every((s) => s.name.length > 0)).toBe(true)
    expect((await getSubagent('HELPER', root))?.tools).toEqual(['read'])
  })
  test('missing dir returns built-ins only', async () => {
    const root = await makeTempRoot()
    const subs = await listSubagents(join(root, 'does-not-exist'))
    expect(subs.length).toBeGreaterThan(0)
    for (const sub of subs) expect(Object.values(BUILT_IN_SUBAGENTS)).toContain(sub)
    expect(await getSubagent('no-such-subagent', root)).toBeUndefined()
  })
})

describe('models-dev catalog', () => {
  const fakeDevProvider = {
    id: 'demo',
    models: {
      basic: { id: 'basic' },
      fancy: {
        id: 'fancy',
        name: 'Fancy Model',
        description: 'Does fancy things',
        limit: { context: 128000, output: 4000 },
        modalities: { input: ['text', 'image'] },
        reasoning_options: [
          { type: 'effort', values: ['low', 'high', null, undefined] },
          { type: 'other', values: ['x'] },
        ],
        cost: { input: 3, output: 6, cache_read: 1, cache_write: 2 },
      },
    },
  } as unknown as ModelsDevProvider
  test('maps defaults and guards missing fields', () => {
    const models = modelsFromModelsDev(fakeDevProvider)
    expect(models.length).toBe(2)
    const basic = models.find((m) => m.id === 'basic')
    expect(basic?.name).toBe('basic')
    expect(basic?.description).toBeUndefined()
    expect(basic?.context).toBe(0)
    expect(basic?.output).toBe(0)
    expect(basic?.supports).toEqual(['text'])
    expect(basic?.efforts).toBeUndefined()
    expect(basic?.billing).toBeUndefined()
  })
  test('maps modalities vision and filters undefined efforts', () => {
    const fancy = modelsFromModelsDev(fakeDevProvider).find((m) => m.id === 'fancy')
    expect(fancy?.supports).toContain('vision')
    expect(fancy?.efforts).toEqual(['low', 'high'])
    expect(fancy?.billing).toEqual({ input: 3, output: 6, cacheRead: 1, cacheWrite: 2 })
    expect(fancy?.context).toBe(128000)
    expect(fancy?.output).toBe(4000)
  })
  test('empty models map to empty list', () => {
    expect(modelsFromModelsDev({ models: {} } as unknown as ModelsDevProvider)).toEqual([])
  })
  test('fetchModelsDevProvider matches env and misses cleanly', async () => {
    expect((await fetchModelsDevProvider('PICOBU_TEST_ENV_MATCH'))?.id).toBe('demo')
    expect(await fetchModelsDevProvider('PICOBU_TEST_ENV_ABSENT_ZZ')).toBeUndefined()
  })
})

describe('provider catalog', () => {
  test('hyper definition shape', () => {
    expect(hyper.id).toBe('hyper')
    expect(hyper.type).toBe('openai-compatible')
    expect(hyper.apiKeyEnv).toBe('HYPER_API_KEY')
    expect(hyper.baseUrl.length).toBeGreaterThan(0)
    expect(hyper.modelsUrl.length).toBeGreaterThan(0)
  })
  test('LLM_PROVIDERS contains hyper', () => {
    expect(LLM_PROVIDERS).toContain(hyper)
  })
  test('upsertProvider replaces and appends', () => {
    const base: ProviderOptions[] = [{ id: 'a', name: 'A', type: 'openai-compatible', baseUrl: 'https://a', models: [] }]
    const next = upsertProvider(base, { id: 'b', name: 'B', type: 'openai-compatible', baseUrl: 'https://b', models: [] })
    expect(next.map((p) => p.id)).toEqual(['a', 'b'])
    const replaced = upsertProvider(next, { id: 'a', name: 'A2', type: 'openai-compatible', baseUrl: 'https://a2', models: [] })
    expect(replaced.map((p) => p.id)).toEqual(['b', 'a'])
    expect(replaced.find((p) => p.id === 'a')?.name).toBe('A2')
  })
})

describe('parseModelsResponse', () => {
  test('rejects invalid payloads', () => {
    expect(parseModelsResponse(null)).toEqual([])
    expect(parseModelsResponse({})).toEqual([])
    expect(parseModelsResponse({ data: [] })).toEqual([])
    expect(parseModelsResponse({ data: [{ id: '' }] })).toEqual([])
  })
  test('maps full entries', () => {
    const [model] = parseModelsResponse({
      data: [
        {
          id: 'm1',
          display_name: 'Model One',
          context_window: 1000,
          max_output_tokens: 200,
          capabilities: { vision: true },
          reasoning: { effort_levels: [{ value: 'low' }, { value: '' }], default_effort_level: 'low' },
          pricing: { input: 1, output: 2, cache_create: 3, cache_hit: 4 },
        },
      ],
    })
    expect(model?.id).toBe('m1')
    expect(model?.name).toBe('Model One')
    expect(model?.context).toBe(1000)
    expect(model?.output).toBe(200)
    expect(model?.supports).toEqual(['text', 'vision'])
    expect(model?.reasoning).toBe(true)
    expect(model?.efforts).toEqual(['low'])
    expect(model?.defaultEffort).toBe('low')
    expect(model?.billing).toEqual({ input: 1, output: 2, cacheRead: 4, cacheWrite: 3 })
  })
  test('falls back without optional fields', () => {
    const [model] = parseModelsResponse({ data: [{ id: 'm2' }] })
    expect(model?.name).toBe('m2')
    expect(model?.supports).toEqual(['text'])
    expect(model?.reasoning).toBeUndefined()
    expect(model?.efforts).toBeUndefined()
    expect(model?.billing).toBeUndefined()
  })
})

describe('model resolver helpers', () => {
  test('resolveApiKey handles env refs and plain keys', () => {
    process.env.PICOBU_TEST_RESOLVE_KEY = 'sekret-value'
    expect(resolveApiKey('env:PICOBU_TEST_RESOLVE_KEY')).toBe('sekret-value')
    delete process.env.PICOBU_TEST_RESOLVE_KEY
    expect(resolveApiKey('plain-key')).toBe('plain-key')
    expect(resolveApiKey(undefined)).toBeUndefined()
    expect(resolveApiKey('')).toBeUndefined()
  })
  test('resolveAuth resolves env keys and throws on missing login', () => {
    process.env.PICOBU_TEST_AUTH_KEY = 'abc'
    const provider: ProviderOptions = { id: 'p', name: 'P', type: 'openai-compatible', baseUrl: 'https://x', apiKey: 'env:PICOBU_TEST_AUTH_KEY', models: [] }
    expect(resolveAuth(provider)).toEqual({ apiKey: 'abc' })
    delete process.env.PICOBU_TEST_AUTH_KEY
    expect(resolveAuth({ ...provider, apiKey: undefined }).apiKey).toBeUndefined()
    const locked: ProviderOptions = { ...provider, apiKey: 'auth:missing-cred-xyz' }
    expect(() => resolveAuth(locked)).toThrow('No saved login')
  })
  test('createModelInstance rejects unknown provider types', () => {
    const bad: ProviderOptions = { id: 'bad', name: 'Bad', type: 'bogus', baseUrl: 'https://bad', models: [] }
    expect(() => createModelInstance(bad, 'm')).toThrow('Unsupported provider type')
  })
  test('listModels keys combine provider and model ids', () => {
    const entries = listModels()
    expect(Array.isArray(entries)).toBe(true)
    for (const entry of entries) expect(entry.key).toBe(`${entry.providerId}/${entry.modelId}`)
  })
})

describe('rules discovery', () => {
  const setupRules = async (): Promise<string> => {
    const root = await makeTempRoot()
    await putFile(root, join('.agents', 'rules', 'good.md'), '---\nname: Good\ndescription: Does good things\n---\nBody\n')
    await putFile(root, join('.agents', 'rules', 'silent.md'), '---\nname: Silent\n---\nNo description here\n')
    return root
  }
  test('loadRules skips entries without description', async () => {
    const root = await setupRules()
    const rules = await loadRules(root)
    expect(rules.some((r) => r.name === 'Good')).toBe(true)
    expect(rules.every((r) => r.name !== 'Silent')).toBe(true)
    expect(rules.find((r) => r.name === 'Good')?.description).toBe('Does good things')
    expect(rules.find((r) => r.name === 'Good')?.path).toContain('good.md')
  })
  test('listRules sync variant agrees', async () => {
    const root = await setupRules()
    const rules = listRules(root)
    expect(rules.some((r) => r.name === 'Good')).toBe(true)
    expect(rules.every((r) => r.name !== 'Silent')).toBe(true)
  })
})

describe('command discovery', () => {
  const setupCommands = async (): Promise<string> => {
    const root = await makeTempRoot()
    await putFile(root, join('.agents', 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: Helps with things\n---\nSkill body\n')
    await putFile(root, join('.agents', 'skills', '.hidden', 'SKILL.md'), '---\nname: hidden\ndescription: Hidden skill\n---\nBody\n')
    await putFile(root, join('.agents', 'skills', 'undescribed', 'SKILL.md'), '---\nname: undescribed\n---\nBody\n')
    await mkdir(join(root, '.agents', 'skills', 'empty-dir'), { recursive: true })
    await putFile(root, join('.agents', 'workflows', 'flow.md'), '---\nname: Flow\ndescription: Runs a flow\n---\nFlow body\n')
    await putFile(root, join('.agents', 'workflows', 'bare-task.md'), '---\ndescription: Bare task runner\n---\nBare body\n')
    return root
  }
  test('catalog finds skills and workflows while skipping hidden and undescribed', async () => {
    const root = await setupCommands()
    const catalog = loadCommandCatalogSync(root)
    expect(catalog.some((c) => c.kind === 'skill' && c.name === 'my-skill')).toBe(true)
    expect(catalog.some((c) => c.kind === 'workflow' && c.name === 'Flow')).toBe(true)
    expect(catalog.some((c) => c.name === 'Bare Task')).toBe(true)
    expect(catalog.every((c) => c.name !== 'undescribed' && !c.name.startsWith('.'))).toBe(true)
    expect((await loadCommandCatalog(root)).length).toBe(catalog.length)
  })
  test('workflow with marker substitutes without appending', async () => {
    const root = await makeTempRoot()
    const path = await putFile(root, 'w.md', '---\nname: W\n---\nDo {USER_PROMPT} now\n')
    const cmd: Command = { kind: 'workflow', name: 'W', aliases: [], title: 'W', description: 'D', path }
    const out = await buildCommandPrompt(cmd, 'extra work')
    expect(out).toContain('Do extra work now')
    expect(out).not.toContain('User request:')
    expect(out).not.toContain('{USER_PROMPT}')
  })
  test('workflow without marker appends user request', async () => {
    const root = await makeTempRoot()
    const path = await putFile(root, 'w.md', '---\nname: W\n---\nDo stuff\n')
    const cmd: Command = { kind: 'workflow', name: 'W', aliases: [], title: 'W', description: 'D', path }
    const out = await buildCommandPrompt(cmd, 'extra work')
    expect(out).toContain('User request:')
    expect(out.endsWith('extra work')).toBe(true)
  })
  test('frontmatter marker does not count as user placeholder', async () => {
    const root = await makeTempRoot()
    const path = await putFile(root, 'w.md', '---\nname: Front\ndescription: needs {USER_PROMPT} ok\n---\nplain body here\n')
    const cmd: Command = { kind: 'workflow', name: 'Front', aliases: [], title: 'Front', description: 'D', path }
    const out = await buildCommandPrompt(cmd, 'extra work')
    expect(out).toContain('User request:')
    expect(out.endsWith('extra work')).toBe(true)
  })
  test('skill substitutes params and appends request', async () => {
    const root = await makeTempRoot()
    const path = await putFile(root, 'SKILL.md', '---\nname: S\ndescription: Skill Desc\n---\nUse {APP_NAME} for {USER_PROMPT}\n')
    const cmd: Command = { kind: 'skill', name: 'S', aliases: [], title: 'Skill Title', description: 'Skill Desc', path }
    const out = await buildCommandPrompt(cmd, 'did stuff')
    expect(out.startsWith('[Skill: Skill Title]')).toBe(true)
    expect(out).toContain('Skill Desc')
    expect(out).toContain(options.app.name)
    expect(out).not.toContain('{APP_NAME}')
    expect(out).not.toContain('{USER_PROMPT}')
    expect(out.endsWith('did stuff')).toBe(true)
  })
  test('empty rest appends nothing', async () => {
    const root = await makeTempRoot()
    const path = await putFile(root, 'SKILL.md', '---\nname: S\ndescription: D\n---\nBody\n')
    const cmd: Command = { kind: 'skill', name: 'S', aliases: [], title: 'T', description: 'D', path }
    expect(await buildCommandPrompt(cmd, '')).not.toContain('User request:')
  })
})

describe('agent prompt texts', () => {
  test('role markdowns are non-empty with key markers', () => {
    expect(askMarkdown).toContain('Picobu')
    expect(askMarkdown).toContain('ask')
    expect(askMarkdown).toContain('discrete options')
    expect(coderMarkdown).toContain('Prime Directives')
    expect(coderMarkdown).toContain('Correctness first')
    expect(coderMarkdown).toContain('Decision Checklist')
    expect(coderMarkdown).toContain('Task Control')
    expect(coderMarkdown).toContain('"todo" flow tool')
    expect(coderMarkdown).toContain('structured "ask" questions')
    expect(coderMarkdown).toContain('"spawn"')
    expect(planMarkdown).toContain('architect')
    expect(planMarkdown).toContain('plan-write')
    expect(planMarkdown).toContain('plan-exit')
    expect(planMarkdown).toContain('Raise "ask" early')
    expect(planMarkdown).toContain('do not also write the plan out in your reply')
    expect(persistentMarkdown).toContain('persistent mode')
    expect(persistentMarkdown).toContain('WhatsApp')
    expect(persistentMarkdown).toContain('wwp-msg')
  })
  test('compactor and summarizer prompts carry markers', () => {
    expect(compactorPrompt).toContain('compactor')
    expect(compactorPrompt).toContain('[INFERENCE]')
    expect(summarizerPrompt).toContain('Summarize')
    expect(summarizerPrompt).toContain('coding-agent')
  })
  test('session title prompt and blank fallback', async () => {
    expect(sessionTitlePrompt).toContain('title')
    expect(sessionTitlePrompt).toContain('50')
    expect(await generateSessionTitle('   ')).toBe('')
  })
  test('session title prompt builds assistant context for regenerations', () => {
    const first = buildTitlePrompt('fix the bug')
    expect(first).toContain('User request:')
    expect(first).toContain('fix the bug')
    expect(first).not.toContain('Last assistant reply:')
    const second = buildTitlePrompt('now add tests', 'Fixed the parser bug in main.ts')
    expect(second).toContain('Last assistant reply:')
    expect(second).toContain('Fixed the parser bug in main.ts')
    expect(second).toContain('now add tests')
    expect(second.indexOf('Last assistant reply:')).toBeLessThan(second.indexOf('User request:'))
    expect(buildTitlePrompt('fix the bug', '   ')).toBe(first)
  })
  test('system markdown has preamble and placeholders', () => {
    expect(systemMarkdown).toContain('System Preamble')
    expect(systemMarkdown).toContain('{APP_NAME}')
    expect(systemMarkdown).toContain('{APP_CWD}')
    expect(systemMarkdown).toContain('{APP_OS}')
    expect(systemMarkdown).toContain('{APP_SHELL}')
  })
  test('section builders mention tool names', () => {
    expect(buildSkillsSection([{ name: 's1', description: 'd1' }])).toContain('s1')
    expect(buildSkillsSection([{ name: 's1', description: 'd1' }])).toContain('skill')
    expect(buildSubagentsSection([{ name: 'g1', description: 'd1' }], 0)).toContain('Spawning is disabled')
    expect(buildSubagentsSection([{ name: 'g1', description: 'd1' }], 3)).toContain('Up to 3')
    expect(buildRulesSection([{ name: 'r1', description: 'd1' }])).toContain('r1')
    expect(buildRulesSection([{ name: 'r1', description: 'd1' }])).toContain('rule')
  })
  test('generateSystemMessage substitutes params and appends sections', () => {
    const sections = generateSystemMessage({ appName: 'TestApp', cwd: '/tmp/wd', os: 'TestOS', shell: 'TestSH' })
    expect(sections.map((s) => s.key)).toContain('System Preamble')
    const joined = sections.map((s) => s.content).join('\n')
    expect(joined).toContain('TestApp')
    expect(joined).toContain('/tmp/wd')
    expect(joined).not.toContain('{APP_NAME}')
    expect(joined).not.toContain('{APP_CWD}')
    const full = generateSystemMessage({
      appName: 'A',
      cwd: 'C',
      os: 'O',
      shell: 'S',
      agentsAppendix: 'APPENDIX-MARK',
      agentPrompt: 'ROLE-MARK',
      skillsInfo: 'SKILLS-MARK',
      rulesInfo: 'RULES-MARK',
      subagentsInfo: 'SUBAGENTS-MARK',
      toolsInfo: 'TOOLS-MARK',
    })
    const byKey = new Map(full.map((s) => [s.key, s.content]))
    expect(byKey.get('System Guidelines')).toContain('APPENDIX-MARK')
    expect(byKey.get('Agent Role')).toContain('ROLE-MARK')
    expect(byKey.get('Skills')).toContain('SKILLS-MARK')
    expect(byKey.get('Rules')).toContain('RULES-MARK')
    expect(byKey.get('Subagents')).toContain('SUBAGENTS-MARK')
    expect(byKey.get('Available Tools')).toContain('TOOLS-MARK')
  })
})

describe('prompt embeds', () => {
  test('counters and labels', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('x')).toBe(1)
    expect(countLines('a\nb\nc')).toBe(3)
    expect(textEmbedLabel('T', 5)).toBe('[T Pasted 1 ~ 5]')
    expect(fileEmbedLabel('F', 'image/png')).toBe('[F File image/png]')
  })
  test('bytes convert to data urls', () => {
    expect(bytesToDataUrl(new Uint8Array([104, 105]), 'text/plain')).toBe('data:text/plain;base64,aGk=')
  })
  test('resolvePrompt replaces text and file tokens', () => {
    const resolved = resolvePrompt('A [T#1 pasted] B [F#2 file] C [T#9 missing] D', { 'T#1': 'HELLO' }, { 'F#2': { mimeType: 'image/png', filename: 'pic.png', dataUrl: 'data:image/png;base64,xx' } })
    expect(resolved.text).toBe('A HELLO B  C  D')
    expect(resolved.files.length).toBe(1)
    expect(resolved.files[0]?.mediaType).toBe('image/png')
    expect(resolved.files[0]?.filename).toBe('pic.png')
  })
})

describe('agents markdown loading', () => {
  test('reads AGENTS.md when present', async () => {
    const root = await makeTempRoot()
    await putFile(root, 'AGENTS.md', 'agents file here')
    expect(await loadAgentsMarkdown(root)).toBe('agents file here')
  })
  test('returns undefined when absent', async () => {
    expect(await loadAgentsMarkdown(await makeTempRoot())).toBeUndefined()
  })
  test('falls back to CLAUDE.md on blank AGENTS.md', async () => {
    const root = await makeTempRoot()
    await putFile(root, 'AGENTS.md', '   \n')
    await putFile(root, 'CLAUDE.md', 'claude notes')
    expect(await loadAgentsMarkdown(root)).toBe('claude notes')
  })
})
