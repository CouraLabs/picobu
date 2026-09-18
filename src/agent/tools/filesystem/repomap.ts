import { readdir, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { insideAgentDir } from '@agent/tools/filesystem/agent-dirs.ts'
import { resolveRgPath } from '@agent/tools/filesystem/rg.ts'
import { sandboxRoot } from '@agent/tools/sandbox.ts'
import type { ToolExecuteOptions } from '@agent/tools/toolset.ts'
import { pathToFiletype } from '@opentui/core'
import { detectFiletype } from '@shared/filetype.ts'
import { getSharedTreeSitterClient } from '@wrappers/treesitter-wrapper.ts'
import z from 'zod'

export const RepoMapArgsSchema = z.object({
  maxTokens: z.number().int().min(256).max(8192).optional().describe('Token budget for the rendered map (default 1024). Higher includes more files.'),
  path: z.string().optional().describe('Subdirectory to map instead of the whole workspace.'),
  focus: z.array(z.string()).optional().describe('File or directory paths to boost in the ranking (e.g. ["src/tools/", "src/config.ts"]).'),
})
const RepoMapOutputSchema = z.object({ filetype: z.string(), content: z.string() })

const CHARS_PER_TOKEN = 4
const MAX_FILES_SCANNED = 400
const MAX_FILE_BYTES = 64 * 1024
const MAX_SYMBOLS_PER_FILE = 40
const MAX_FILES_RENDERED = 24

interface RankedFile {
  path: string
  dir: string
  name: string
  score: number
  symbols: Array<string>
}

const SYMBOL_GROUPS = new Set(['function', 'method', 'type', 'class', 'struct', 'interface', 'enum', 'module', 'namespace', 'constructor'])
const KEYWORDS = new Set([
  'function',
  'class',
  'def',
  'fn',
  'func',
  'struct',
  'interface',
  'enum',
  'type',
  'const',
  'let',
  'var',
  'export',
  'import',
  'default',
  'async',
  'await',
  'public',
  'private',
  'protected',
  'static',
  'new',
  'return',
  'impl',
  'trait',
  'package',
  'protocol',
  'extension',
  'sub',
  'end',
  'val',
  'object',
  'data',
  'sealed',
  'abstract',
  'final',
  'override',
  'open',
  'external',
  'declare',
  'from',
  'as',
])

const identifierFromSpan = (text: string): string | undefined => {
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/[^A-Za-z0-9_$]/g, '')
    if (!token) continue
    if (KEYWORDS.has(token)) continue
    if (/^[0-9]/.test(token)) continue
    return token
  }
  return undefined
}

const symbolKindFromHighlight = (group: string): string | undefined => {
  const clean = group.replace(/^@/, '')
  const segments = clean.split('.')
  if (segments.some((segment) => segment === 'builtin' || segment === 'call' || segment === 'parameter')) return undefined
  const base = segments[0] ?? ''
  return SYMBOL_GROUPS.has(base) ? (base === 'function' && segments.includes('method') ? 'method' : base) : undefined
}

const KIND_PRIORITY: Array<string> = ['method', 'function', 'class', 'struct', 'interface', 'enum', 'module', 'namespace', 'constructor', 'type']

const lineStartOf = (content: string, offset: number): { line: string; lineStart: number } => {
  const lineStart = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const lineEnd = content.indexOf('\n', offset)
  return { line: content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd), lineStart }
}

const FALLBACK_EXTRACTORS: Record<string, Array<RegExp>> = {
  typescript: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/gm,
    /^\s*(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/gm,
  ],
  javascript: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/gm,
  ],
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/gm, /^\s*class\s+([A-Za-z0-9_]+)/gm],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/gm, /^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/gm],
  rust: [
    /^\s*(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)/gm,
    /^\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/gm,
    /^\s*(?:pub\s+)?enum\s+([A-Za-z0-9_]+)/gm,
    /^\s*(?:pub\s+)?trait\s+([A-Za-z0-9_]+)/gm,
  ],
  java: [
    /^\s*(?:public|private|protected)?\s*(?:final\s+|abstract\s+|static\s+)*class\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:public|private|protected)?\s*(?:static\s+)*interface\s+([A-Za-z0-9_$]+)/gm,
    /^\s*(?:public|private|protected)?\s*(?:static\s+)*enum\s+([A-Za-z0-9_$]+)/gm,
  ],
}

const fallbackFiletype = (path: string): string | undefined => {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript'
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.py':
      return 'python'
    case '.go':
      return 'go'
    case '.rs':
      return 'rust'
    case '.java':
      return 'java'
    default:
      return undefined
  }
}

const symbolsViaRegex = (path: string, content: string): Array<string> => {
  const filetype = fallbackFiletype(path)
  if (!filetype) return []
  const patterns = FALLBACK_EXTRACTORS[filetype] ?? []
  const found: Array<string> = []
  const seen = new Set<string>()
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      const name = match[1]
      if (!name || seen.has(name)) continue
      seen.add(name)
      found.push(name)
      if (found.length >= MAX_SYMBOLS_PER_FILE) return found
    }
  }
  return found
}

const isImportLine = (line: string): boolean => {
  const trimmed = line.trimStart()
  return /^(import\b|from\b|#import\b)/.test(trimmed) || (trimmed.includes(' from ') && /^\}?\s*from\b/.test(trimmed.replace(/^\}/, '').trimStart()))
}

const symbolsViaTreeSitter = async (filetype: string, content: string): Promise<Array<string> | undefined> => {
  let client: Awaited<ReturnType<typeof getSharedTreeSitterClient>>
  try {
    client = await getSharedTreeSitterClient()
  } catch {
    return undefined
  }
  try {
    const result = await client.highlightOnce(content.slice(0, MAX_FILE_BYTES), filetype)
    if (result.error) return undefined
    if (!result.highlights || result.highlights.length === 0) return result.warning ? undefined : []
    const spans = new Map<string, { start: number; end: number; kinds: Set<string> }>()
    for (const [start, end, group] of result.highlights) {
      const kind = symbolKindFromHighlight(group)
      if (!kind) continue
      const key = `${start}:${end}`
      const span = spans.get(key)
      if (span) span.kinds.add(kind)
      else spans.set(key, { start, end, kinds: new Set([kind]) })
    }
    const found: Array<string> = []
    const seen = new Set<string>()
    for (const span of spans.values()) {
      const ordered = KIND_PRIORITY.filter((kind) => span.kinds.has(kind))
      const kind = ordered[0]
      if (!kind) continue
      const spanText = content.slice(Math.max(0, span.start), Math.min(content.length, span.end))
      const name = identifierFromSpan(spanText)
      if (!name || seen.has(name)) continue
      if (kind === 'type' && !/^[A-Z]/.test(name)) continue
      const { line } = lineStartOf(content, span.start)
      if (isImportLine(line)) continue
      seen.add(name)
      found.push(`${name} (${kind})`)
      if (found.length >= MAX_SYMBOLS_PER_FILE) break
    }
    return found
  } catch {
    return undefined
  }
}

const extractSymbols = async (path: string): Promise<Array<string>> => {
  const filetype = pathToFiletype(path) ?? fallbackFiletype(path)
  if (!filetype) return []
  let content: string
  try {
    const file = Bun.file(path)
    if (file.size > MAX_FILE_BYTES) content = await file.slice(0, MAX_FILE_BYTES).text()
    else content = await file.text()
  } catch {
    return []
  }
  const parsed = await symbolsViaTreeSitter(filetype, content)
  if (parsed !== undefined) return parsed
  return symbolsViaRegex(path, content)
}

const isAgentDirPath = (path: string): boolean => {
  try {
    return insideAgentDir(path)
  } catch {
    return false
  }
}

const DISCOVER_TIMEOUT_MS = 30_000

const discoverFiles = async (searchPath: string): Promise<Array<string>> => {
  const rgPath = await resolveRgPath()
  const args = [rgPath, '--files', ...(isAgentDirPath(searchPath) ? ['--hidden', '--no-ignore-vcs'] : []), '--', searchPath]
  const proc = Bun.spawn({ cmd: args, cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
  const timeout = setTimeout(() => proc.kill(9), DISCOVER_TIMEOUT_MS)
  try {
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (exitCode === 0 || exitCode === 1) {
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    }
  } finally {
    clearTimeout(timeout)
  }
  const entries: Array<string> = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || entries.length > MAX_FILES_SCANNED * 3) return
    let dirents: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      const full = resolve(dir, dirent.name)
      if (dirent.isDirectory()) await walk(full, depth + 1)
      else if (dirent.isFile()) entries.push(full)
    }
  }
  await walk(searchPath, 0)
  return entries
}

const scoreFile = (relPath: string, focus: Array<string>): number => {
  const depth = relPath.split('/').length - 1
  let score = 100 - depth * 8
  if (/(^|\/)(src|lib|app|pkg|internal)(\/|$)/.test(relPath)) score += 25
  if (/(^|\/)(tests?|__tests__|spec|fixtures?|mocks?)(\/|$)/.test(relPath)) score -= 40
  if (/(^|\/)(docs?|examples?|benchmarks?)(\/|$)/.test(relPath)) score -= 45
  if (/\.(md|txt|json|ya?ml|toml|lock|log|csv)$/i.test(relPath)) score -= 55
  for (const item of focus) {
    const normalized = item.replace(/\/+$/, '')
    if (relPath === normalized || relPath.startsWith(`${normalized}/`) || relPath.endsWith(normalized)) {
      score += 60
      break
    }
  }
  return score
}

const buildMap = async (root: string, searchPath: string, focus: Array<string>): Promise<Array<RankedFile>> => {
  const files = (await discoverFiles(searchPath)).slice(0, MAX_FILES_SCANNED)
  const ranked: Array<RankedFile> = []
  for (const file of files) {
    if (isAgentDirPath(file)) continue
    const rel = relative(root, file).split('\\').join('/')
    const symbols = await extractSymbols(file)
    ranked.push({ path: rel, dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.', name: rel.slice(rel.lastIndexOf('/') + 1), score: scoreFile(rel, focus) + symbols.length * 2, symbols })
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
}

interface CacheEntry {
  focusKey: string
  map: Array<RankedFile>
}

const cache = new Map<string, CacheEntry>()

const getMap = async (root: string, searchPath: string, focus: Array<string>): Promise<Array<RankedFile>> => {
  const key = `${root}|${searchPath}`
  const focusKey = focus.join('\u0000')
  const cached = cache.get(key)
  if (cached && cached.focusKey === focusKey) return cached.map
  const map = await buildMap(root, searchPath, focus)
  cache.set(key, { focusKey, map })
  return map
}

const renderMap = (ranked: Array<RankedFile>, root: string, maxChars: number): string => {
  const lines: Array<string> = [`Repository map for ${root}`, '']
  let used = lines.join('\n').length + 1
  let included = 0
  let symbolsIncluded = 0
  let omitted = 0
  let currentDir: string | undefined
  for (const file of ranked) {
    const sameDir = file.dir === currentDir
    const symbolLines = file.symbols.map((symbol) => `  ${symbol}`)
    const cost = (sameDir ? 0 : file.dir.length + 2) + file.name.length + 1 + (symbolLines.length > 0 ? `${symbolLines.join('\n')}\n`.length : 0)
    if (used + cost > maxChars) {
      omitted += 1
      continue
    }
    if (!sameDir) {
      currentDir = file.dir
      lines.push(`${file.dir}/`)
      used += file.dir.length + 2
    }
    lines.push(file.name)
    lines.push(...symbolLines)
    symbolsIncluded += symbolLines.length
    included += 1
    used += cost
    if (included >= MAX_FILES_RENDERED) break
  }
  if (included === 0) return 'No source files found to map.'
  lines.push('', `(${included} files, ${symbolsIncluded} symbols${omitted > 0 ? `, ${omitted} more beyond budget — raise maxTokens or narrow path` : ''})`)
  return lines.join('\n')
}

export const repoMapTool = {
  name: 'repo_map',
  description:
    'Structural map of the repository: top files ranked by relevance with their key symbols (functions, classes, types) extracted via tree-sitter, capped to a token budget. Use it to orient in an unfamiliar codebase before grep/read; pass focus to boost files you already care about.',
  parameters: RepoMapArgsSchema,
  output: RepoMapOutputSchema,
  kind: 'filesystem' as const,
  handler: async (args: z.infer<typeof RepoMapArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof RepoMapOutputSchema>> => {
    const sandbox = sandboxRoot(toolOptions?.experimental_sandbox)
    const root = sandbox ?? process.cwd()
    const searchPath = args.path ? resolve(root, args.path) : root
    if (args.path) {
      const rel = relative(resolve(root), resolve(searchPath))
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes working directory: ${args.path}`)
    }
    const info = await stat(searchPath).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error(`Not a directory: ${searchPath}`)
    const focus = (args.focus ?? []).map((item) => relative(root, resolve(root, item)).split('\\').join('/'))
    const maxTokens = args.maxTokens ?? 1024
    const ranked = await getMap(root, searchPath, focus)
    const content = renderMap(ranked, root, maxTokens * CHARS_PER_TOKEN)
    return { filetype: detectFiletype(root), content }
  },
}
