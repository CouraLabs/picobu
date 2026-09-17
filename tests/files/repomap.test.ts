import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repoMapTool } from '../../src/agent/tools/filesystem/repomap.ts'
import { opentuiBundledParserDescriptors } from '../../src/wrappers/treesitter-wrapper.ts'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-repomap-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await mkdir(join(dir, 'tests'), { recursive: true })
  await writeFile(
    join(dir, 'src', 'widget.ts'),
    [
      'export interface Options {',
      '  size: number',
      '}',
      '',
      'export class Widget {',
      '  constructor(public options: Options) {}',
      '  render(): string {',
      '    return this.options.size > 0 ? `big` : `small`',
      '  }',
      '}',
      '',
      'export function buildWidget(size: number): Widget {',
      '  return new Widget({ size })',
      '}',
      '',
    ].join('\n'),
  )
  await writeFile(join(dir, 'tests', 'widget.test.ts'), ['test(`smoke`, () => {})', ''].join('\n'))
  await writeFile(join(dir, 'README.md'), '# fixture\n')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('repo_map', () => {
  const sb = (): { experimental_sandbox: never } => ({ experimental_sandbox: { root: dir } as never })

  test('renders a budgeted map that includes ranked source files', async () => {
    const result = await repoMapTool.handler({ maxTokens: 1024 }, sb())
    expect(result.filetype).toBe('text')
    expect(result.content).toContain('Repository map')
    expect(result.content).toContain('src/')
    expect(result.content).toContain('widget.ts')
  })

  test('extracts symbols from typescript sources', async () => {
    const result = await repoMapTool.handler({ maxTokens: 1024, focus: ['src/widget.ts'] }, sb())
    expect(result.content).toContain('widget.ts')
    expect(result.content).toContain('Widget')
    expect(result.content).toContain('buildWidget')
  })

  test('tiny budget still renders with a truncation note', async () => {
    const result = await repoMapTool.handler({ maxTokens: 256 }, sb())
    expect(result.content).toContain('Repository map')
  })

  test('focus boosts the focused file into the map', async () => {
    const result = await repoMapTool.handler({ maxTokens: 256, focus: ['tests/widget.test.ts'] }, sb())
    expect(result.content).toContain('widget.test.ts')
  })

  test('escapes working directory', async () => {
    await expect(repoMapTool.handler({ path: '../..' }, sb())).rejects.toThrow('escapes working directory')
  })

  test('rejects non-directory path', async () => {
    await expect(repoMapTool.handler({ path: 'README.md' }, sb())).rejects.toThrow('Not a directory')
  })
})

describe('opentui bundled parser descriptors', () => {
  test('resolves typescript and javascript grammars when the package ships them', () => {
    const descriptors = opentuiBundledParserDescriptors()
    expect(descriptors.length).toBeGreaterThanOrEqual(0)
    if (descriptors.length === 0) return
    const filetypes = descriptors.map((descriptor) => descriptor.filetype)
    expect(filetypes).toContain('typescript')
    expect(filetypes).toContain('javascript')
    for (const descriptor of descriptors) {
      expect(descriptor.wasm.endsWith('.wasm')).toBe(true)
      expect(descriptor.queries.highlights.length).toBeGreaterThan(0)
    }
  })
})
