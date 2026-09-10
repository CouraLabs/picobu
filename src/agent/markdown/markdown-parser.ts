import { readFile } from 'node:fs/promises'

export type Frontmatter = Record<string, unknown>
export type ParsedMarkdown<F extends Frontmatter = Frontmatter> = F & {
  content: string
}
export type MarkdownParam = {
  param: string
  value: string
}

const NEWLINE = /\r?\n/
const FRONTMATTER_DELIMITER = /^---\s*$/
const FRONTMATTER_SCAN_LINES = 20
const STRING_FRONTMATTER_KEYS = new Set(['name', 'title', 'description', 'category', 'tools', 'model', 'color', 'path', 'aliases'])

export function parseMarkdown<F extends Frontmatter = Frontmatter>(raw: string, params: MarkdownParam[] = []): ParsedMarkdown<F> {
  const source = raw.replace(/^\uFEFF/, '')
  const lines = source.split(NEWLINE)
  let frontmatterStart = 0
  while (frontmatterStart < lines.length && (lines[frontmatterStart]?.trim() ?? '') === '') frontmatterStart++
  const first = lines[frontmatterStart]?.trim() ?? ''
  if (!FRONTMATTER_DELIMITER.test(first)) return { content: applyParams(raw, params) } as ParsedMarkdown<F>
  let closingIndex = -1
  const limit = Math.min(lines.length, frontmatterStart + FRONTMATTER_SCAN_LINES)
  for (let i = frontmatterStart + 1; i < limit; i++) {
    if (FRONTMATTER_DELIMITER.test(lines[i]?.trim() ?? '')) {
      closingIndex = i
      break
    }
  }
  if (closingIndex === -1) return { content: applyParams('', params) } as ParsedMarkdown<F>
  const yamlRaw = lines.slice(frontmatterStart + 1, closingIndex).join('\n')
  const content = applyParams(lines.slice(closingIndex + 1).join('\n'), params)
  return {
    ...parseYamlBlock(yamlRaw),
    content,
  } as ParsedMarkdown<F>
}

export async function parseMarkdownFile<F extends Frontmatter = Frontmatter>(filePath: string, params: MarkdownParam[] = []): Promise<ParsedMarkdown<F>> {
  return parseMarkdown<F>(await readFile(filePath, 'utf8'), params)
}

function applyParams(content: string, params: MarkdownParam[]): string {
  if (params.length === 0) return content
  let result = content
  for (const { param, value } of params) {
    result = result.split(param).join(value)
  }
  return result
}

function parseYamlBlock(raw: string): Frontmatter {
  const result: Frontmatter = {}
  for (const rawLine of raw.split(NEWLINE)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    if (!key) continue
    let value = line.slice(separator + 1).trim()
    if (!value) {
      result[key] = value
      continue
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = coerceScalar(key, value)
  }
  return result
}

function coerceScalar(key: string, value: string): unknown {
  if (STRING_FRONTMATTER_KEYS.has(key.toLowerCase())) return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}
