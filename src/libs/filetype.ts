/**
 * Map a file path (or name) to the OpentUI syntax `filetype` used by the `code`
 * component. Only extensions the bundled tree-sitter parsers understand map to a
 * real type; everything else falls back to plain `text`.
 */
const EXT_TO_FILETYPE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".jsonc": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".py": "python",
  ".pyw": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".java": "java",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".php": "php",
};

/** Detect a syntax-highlighting filetype from a path/name; defaults to `text`. */
export function detectFiletype(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  return EXT_TO_FILETYPE[name.slice(dot).toLowerCase()] ?? "text";
}