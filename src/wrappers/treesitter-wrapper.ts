import {
  addDefaultParsers,
  getTreeSitterClient,
  TreeSitterClient,
  type FiletypeParserOptions,
} from "@opentui/core";
import { getParsers } from "@wrappers/parsers/assets.ts";
import { homedir } from "node:os";
import { join } from "node:path";
export { destroyTreeSitterClient } from "@opentui/core";
export type ParserDescriptor = FiletypeParserOptions;


export type CreateTreeSitterClientOptions = {
  dataPath?: string;
  initTimeout?: number;
};


export function loadParsers(): Promise<ParserDescriptor[]> {
  return getParsers();
}


export async function registerParsers(): Promise<void> {
  addDefaultParsers(await loadParsers());
}


export async function attachParsers(client: TreeSitterClient): Promise<void> {
  for (const parser of await loadParsers()) {
    client.addFiletypeParser(parser);
  }
}


export async function createTreeSitterClient(options?: CreateTreeSitterClientOptions): Promise<TreeSitterClient> {
  const client = new TreeSitterClient({
    dataPath: options?.dataPath ?? join(homedir(), ".picobu", "tree-sitter"),
    ...(options?.initTimeout !== undefined ? { initTimeout: options.initTimeout } : {}),
  });
  try {
    await attachParsers(client);
    await client.initialize();
  } catch (error) {
    await client.destroy();
    throw error;
  }
  return client;
}


export async function getSharedTreeSitterClient(): Promise<TreeSitterClient> {
  if (!sharedClient) {
    const client = getTreeSitterClient();
    await client.initialize();
    await attachParsers(client);
    sharedClient = client;
  }
  return sharedClient;
}

let sharedClient: TreeSitterClient | undefined;

/**
 * The shared client once `getSharedTreeSitterClient()` has resolved, or
 * `undefined` before that (or if initialization failed). Markdown and code
 * renderables take the client as a prop and have no internal fallback, so
 * components read this synchronously after startup has awaited resolution.
 */
export const getSharedTreeSitterClientSync = (): TreeSitterClient | undefined => sharedClient;
