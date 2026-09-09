import { createMemo, Show } from "solid-js"
import { theme } from "@states/theme-state.ts"
import { getSharedTreeSitterClientSync } from "@wrappers/treesitter-wrapper.ts"

export type DiffProps = {
  diff: string
  maxHeight?: number
}

const DIFF_MAX_VISIBLE_LINES = 14

/**
 * Maps a file extension to the tree-sitter filetype OpenTUI has a parser for.
 * Extensions that share their name with the language are handled by the
 * fallback; only divergent ones are listed here. tsx/jsx use the *react
 * aliases OpenTUI registers for its bundled TypeScript/JavaScript grammars —
 * "react" itself is not a filetype anywhere.
 */
export const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  jsx: "javascriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  jsonc: "json",
  dart: "dart",
  sol: "solidity",
  ps1: "powershell",
  psm1: "powershell",
  svelte: "svelte",
  m: "objc",
  "": "plaintext",
}

/** Tree-sitter filetype for a file path; falls back to the bare extension. */
export const filetypeFromPath = (path: string): string => {
  const extension = path.split(".").pop()?.toLowerCase() ?? ""
  if (extension === "" || extension === path.toLowerCase()) return "plaintext"
  return EXTENSION_LANGUAGE[extension] ?? extension
}

/**
 * Best-effort language for a unified diff, parsed from the `+++ b/path`
 * (or `Index: path`) header. Falls back to plaintext when no path is found.
 */
const filetypeFromDiff = (diff: string): string => {
  for (const line of diff.split(/\r?\n/)) {
    const header = line.startsWith("+++ ")
      ? line.slice(4)
      : line.startsWith("Index: ")
        ? line.slice(7)
        : undefined
    if (header === undefined || header === "/dev/null") continue
    const path = header.replace(/^b\//, "").split(/\s/, 1)[0] ?? header
    return filetypeFromPath(path)
  }
  return "plaintext"
}

export const Diff = (props: DiffProps) => {
  const height = createMemo(() => {
    const lines = props.diff.split(/\r?\n/).filter((line) => line.length > 0)
    return Math.max(1, Math.min(lines.length, props.maxHeight ?? DIFF_MAX_VISIBLE_LINES))
  })

  return (
    <Show when={props.diff.length > 0}>
      <diff
        width="100%"
        maxHeight={height()}
        diff={props.diff}
        showLineNumbers
        filetype={filetypeFromDiff(props.diff)}
        treeSitterClient={getSharedTreeSitterClientSync()}
        syntaxStyle={theme().syntax}
        lineNumberFg={theme().diffLineNumber}
        addedBg={theme().diffAddedBg}
        removedBg={theme().diffRemovedBg}
        contextBg={theme().diffContextBg}
        addedLineNumberBg={theme().diffAddedLineNumberBg}
        removedLineNumberBg={theme().diffRemovedLineNumberBg}
        addedSignColor={theme().diffAdded}
        removedSignColor={theme().diffRemoved}
      />
    </Show>
  )
}
