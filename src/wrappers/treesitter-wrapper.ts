import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addDefaultParsers, type FiletypeParserOptions, getTreeSitterClient, TreeSitterClient } from '@opentui/core'
import { getParsers } from '@wrappers/parsers/assets.ts'

export { destroyTreeSitterClient } from '@opentui/core'
export type ParserDescriptor = FiletypeParserOptions

export interface CreateTreeSitterClientOptions {
  dataPath?: string
  initTimeout?: number
}

// @opentui/core bundles tree-sitter grammars for the languages it highlights but
// does not expose them through its default parser registry (its internal
// descriptors stay private). These grammars are shipped inside the package under
// assets/, so agent-side consumers (repo map) can register them directly instead
// of downloading copies. Skipped silently when a future opentui version drops them.
interface OpentuiBundledParser {
  filetype: string
  aliases: Array<string>
  wasm: string
  highlights: string
}

const opentuiBundledParsers: Array<OpentuiBundledParser> = [
  { filetype: 'typescript', aliases: ['ts', 'tsx', 'typescriptreact'], wasm: 'typescript/tree-sitter-typescript.wasm', highlights: 'typescript/highlights.scm' },
  { filetype: 'javascript', aliases: ['js', 'jsx', 'javascriptreact'], wasm: 'javascript/tree-sitter-javascript.wasm', highlights: 'javascript/highlights.scm' },
]

const opentuiAssetsDir = (): string | undefined => {
  try {
    return join(dirname(fileURLToPath(import.meta.resolve('@opentui/core/package.json'))), 'assets')
  } catch {
    return undefined
  }
}

export const opentuiBundledParserDescriptors = (): Array<FiletypeParserOptions> => {
  const assets = opentuiAssetsDir()
  if (!assets) return []
  const out: Array<FiletypeParserOptions> = []
  for (const parser of opentuiBundledParsers) {
    const wasm = join(assets, parser.wasm)
    const highlights = join(assets, parser.highlights)
    if (!existsSync(wasm) || !existsSync(highlights)) continue
    out.push({ filetype: parser.filetype, aliases: [...parser.aliases], queries: { highlights: [highlights] }, wasm })
  }
  return out
}

export function loadParsers(): Promise<Array<ParserDescriptor>> {
  return getParsers().then((downloaded) => [...downloaded, ...opentuiBundledParserDescriptors()])
}

export async function registerParsers(): Promise<void> {
  addDefaultParsers(await loadParsers())
}

export async function attachParsers(client: TreeSitterClient): Promise<void> {
  for (const parser of await loadParsers()) {
    client.addFiletypeParser(parser)
  }
}

export async function createTreeSitterClient(options?: CreateTreeSitterClientOptions): Promise<TreeSitterClient> {
  const client = new TreeSitterClient({
    dataPath: options?.dataPath ?? join(homedir(), '.picobu', 'tree-sitter'),
    ...(options?.initTimeout !== undefined ? { initTimeout: options.initTimeout } : {}),
  })
  try {
    await attachParsers(client)
    await client.initialize()
  } catch (error) {
    await client.destroy()
    throw error
  }
  return client
}

export async function getSharedTreeSitterClient(): Promise<TreeSitterClient> {
  if (sharedClient) return sharedClient
  if (!sharedClientPromise) {
    sharedClientPromise = (async () => {
      const client = getTreeSitterClient()
      await attachParsers(client)
      await client.initialize()
      sharedClient = client
      return client
    })().catch((error) => {
      sharedClientPromise = undefined
      throw error
    })
  }
  return sharedClientPromise
}

let sharedClient: TreeSitterClient | undefined
let sharedClientPromise: Promise<TreeSitterClient> | undefined

export const getSharedTreeSitterClientSync = (): TreeSitterClient | undefined => sharedClient
