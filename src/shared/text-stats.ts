

export interface TextStats {
  words: number;
  lines: number;
  chars: number;
  avgWordLength: number;
}


export function extractWords(text: string): string[] {
  return text
    .split(/[\s,;:.!?()"'/[\]{}]+/)
    .filter((w) => w.length > 0);
}


export function textStats(text: string): TextStats {
  const words = extractWords(text);
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  return {
    words: words.length,
    lines: text.split(/\r?\n/).length,
    chars: text.length,
    avgWordLength: words.length === 0 ? 0 : totalChars / words.length,
  };
}


export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}