import { homedir } from 'node:os'
import { join } from 'node:path'
import { addDefaultParsers, type FiletypeParserOptions, getTreeSitterClient, TreeSitterClient } from '@opentui/core'
import { getParsers } from '@wrappers/parsers/assets.ts'

export { destroyTreeSitterClient } from '@opentui/core'
export type ParserDescriptor = FiletypeParserOptions

export type CreateTreeSitterClientOptions = {
  dataPath?: string
  initTimeout?: number
}

export function loadParsers(): Promise<ParserDescriptor[]> {
  return getParsers()
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
