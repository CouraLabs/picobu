import { readFile } from "node:fs/promises";

export type Frontmatter = Record<string, unknown>;

export type ParsedMarkdown<F extends Frontmatter = Frontmatter> = F & {
  content: string;
};

export type MarkdownParam = {
  param: string;
  value: string;
};

// A `---` line used both as the frontmatter opening and closing delimiter. The
// opening is anchored at the start of the file; the closing may appear further
// down so it is matched as a full line.
const DELIMITER = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;
const NEWLINE = /\r?\n/;

/**
 * Parse a markdown string with an optional YAML frontmatter block at the top,
 * delimited by `---` lines (e.g. the prompt files under `src/agent/prompts`).
 *
 * When a frontmatter block is present, its YAML key/value pairs are spread onto
 * the result and the body after the closing `---` is returned as `content`.
 * When a frontmatter block is present, its YAML key/value pairs are spread onto
 * the result and the body after the closing `---` is returned as `content`.
 * Files without a frontmatter block are returned whole as `{ content }`.
 *
 * `params` replaces any occurrences of each `param` placeholder with its
 * `value` in the parsed content (e.g. `{APP_CWD}` -> `options.app.cwd`).
 */
export function parseMarkdown<F extends Frontmatter = Frontmatter>(
  raw: string,
  params: MarkdownParam[] = [],
): ParsedMarkdown<F> {
  const source = raw.replace(/^\uFEFF/, "");

  const opening = DELIMITER.exec(source);
  if (!opening) return { content: applyParams(raw, params) } as ParsedMarkdown<F>;

  const bodyStart = opening.index + opening[0].length;
  const closing = DELIMITER.exec(source.slice(bodyStart));

  // No closing delimiter -> treat the whole file as content.
  if (!closing) return { content: applyParams(raw, params) } as ParsedMarkdown<F>;

  const yamlRaw = source.slice(bodyStart, bodyStart + closing.index);
  const contentStart = bodyStart + closing.index + closing[0].length;
  const content = applyParams(source.slice(contentStart), params);

  return {
    ...parseYamlBlock(yamlRaw),
    content,
  } as ParsedMarkdown<F>;
}

/**
 * Load and parse a markdown file from disk.
 */
export async function parseMarkdownFile<F extends Frontmatter = Frontmatter>(
  filePath: string,
  params: MarkdownParam[] = [],
): Promise<ParsedMarkdown<F>> {
  return parseMarkdown<F>(await readFile(filePath, "utf8"), params);
}

function applyParams(content: string, params: MarkdownParam[]): string {
  if (params.length === 0) return content;
  let result = content;
  for (const { param, value } of params) {
    result = result.split(param).join(value);
  }
  return result;
}

/**
 * Minimal flat YAML block parser covering the frontmatter shape used by the
 * prompt files (`key: value` pairs and `key:` with empty values). Unsupported
 * YAML features (nested maps, lists, aliases) are intentionally left as scalar
 * strings rather than guessed.
 */
function parseYamlBlock(raw: string): Frontmatter {
  const result: Frontmatter = {};

  for (const rawLine of raw.split(NEWLINE)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key) continue;

    let value = line.slice(separator + 1).trim();
    if (!value) {
      result[key] = value;
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = coerceScalar(value);
  }

  return result;
}

function coerceScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}