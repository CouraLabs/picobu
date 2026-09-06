import { readFile } from "node:fs/promises";
export type Frontmatter = Record<string, unknown>;
export type ParsedMarkdown<F extends Frontmatter = Frontmatter> = F & {
  content: string;
};
export type MarkdownParam = {
  param: string;
  value: string;
};




const DELIMITER = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;
const NEWLINE = /\r?\n/;


export function parseMarkdown<F extends Frontmatter = Frontmatter>(
  raw: string,
  params: MarkdownParam[] = [],
): ParsedMarkdown<F> {
  const source = raw.replace(/^\uFEFF/, "");
  const opening = DELIMITER.exec(source);
  if (!opening) return { content: applyParams(raw, params) } as ParsedMarkdown<F>;
  const bodyStart = opening.index + opening[0].length;
  const closing = DELIMITER.exec(source.slice(bodyStart));

  
  if (!closing) return { content: applyParams(raw, params) } as ParsedMarkdown<F>;
  const yamlRaw = source.slice(bodyStart, bodyStart + closing.index);
  const contentStart = bodyStart + closing.index + closing[0].length;
  const content = applyParams(source.slice(contentStart), params);
  return {
    ...parseYamlBlock(yamlRaw),
    content,
  } as ParsedMarkdown<F>;
}


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