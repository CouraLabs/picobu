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

/** Options for `createTreeSitterClient` — all optional. */
export type CreateTreeSitterClientOptions = {
  /** Directory the client caches remote assets in. Defaults to `~/.picobu/tree-sitter`. */
  dataPath?: string;
  /** Worker init timeout in ms. Defaults to the client's 10s. */
  initTimeout?: number;
};

/**
 * Resolve the parser descriptors from the local assets downloaded by
 * `bun run parsers:update` (`src/wrappers/parsers/<filetype>/`). One descriptor
 * per grammar; aliases (e.g. `diff` → `udiff`/`patch`) are already included.
 */
export function loadParsers(): Promise<ParserDescriptor[]> {
  return getParsers();
}

/**
 * Register the extra-language parsers module-wide, so every TreeSitterClient
 * created afterwards (including the global one from `getTreeSitterClient()`)
 * picks them up during initialization.
 *
 * Must run before any client initializes. For clients that already exist,
 * use `attachParsers` instead.
 */
export async function registerParsers(): Promise<void> {
  addDefaultParsers(await loadParsers());
}

/**
 * Register the extra-language parsers on a single client instance. Works both
 * before and after `client.initialize()` — a descriptor whose `filetype` is
 * already registered (e.g. a bundled grammar) replaces it.
 *
 * OpenTUI bundles JavaScript/TypeScript, Markdown and Zig; this adds every
 * other grammar declared in `src/wrappers/parsers/config.ts`.
 */
export async function attachParsers(client: TreeSitterClient): Promise<void> {
  for (const parser of await loadParsers()) {
    client.addFiletypeParser(parser);
  }
}

/**
 * Create an owned `TreeSitterClient` with every extra-language parser already
 * attached and initialized. The caller owns the returned client and must
 * `await client.destroy()` when done (the worker is started eagerly in the
 * constructor). Use `getSharedTreeSitterClient` for process-wide sharing.
 *
 * OpenTUI bundles JavaScript/TypeScript, Markdown and Zig; this adds every
 * other grammar declared in `src/wrappers/parsers/config.ts`.
 */
export async function createTreeSitterClient(options?: CreateTreeSitterClientOptions): Promise<TreeSitterClient> {
  const client = new TreeSitterClient({
    dataPath: options?.dataPath ?? join(homedir(), ".picobu", "tree-sitter"),
    ...(options?.initTimeout !== undefined ? { initTimeout: options.initTimeout } : {}),
  });
  try {
    await attachParsers(client);
    await client.initialize();
  } catch (error) {
    // Don't leak the worker if startup failed.
    await client.destroy();
    throw error;
  }
  return client;
}

/**
 * Process-wide shared client (`getTreeSitterClient`) with every extra-language
 * parser attached. Safe to call repeatedly — the singleton initializes once
 * and parser registration is idempotent. Destroy with
 * `destroyTreeSitterClient()` (re-exported from this module).
 */
export async function getSharedTreeSitterClient(): Promise<TreeSitterClient> {
  const client = getTreeSitterClient();
  await client.initialize();
  await attachParsers(client);
  return client;
}
