export interface TextStats {
  words: number
  lines: number
  chars: number
  avgWordLength: number
}

export function extractWords(text: string): Array<string> {
  return text.split(/[\s,;:.!?()"'/[\]{}]+/).filter((w) => w.length > 0)
}

export function textStats(text: string): TextStats {
  const words = extractWords(text)
  const totalChars = words.reduce((sum, w) => sum + w.length, 0)
  return {
    words: words.length,
    lines: text.split(/\r?\n/).length,
    chars: text.length,
    avgWordLength: words.length === 0 ? 0 : totalChars / words.length,
  }
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let index = haystack.indexOf(needle, 0)
  while (index !== -1) {
    count += 1
    index += needle.length
    index = haystack.indexOf(needle, index)
  }
  return count
}

const dropSplitSurrogate = (text: string, end: number): number => {
  const last = text.charCodeAt(end - 1)
  return last >= 0xd800 && last <= 0xdbff ? end - 1 : end
}

export function truncate(text: string, max = 60): string {
  if (text.length <= max) return text
  if (max < 3) return text.slice(0, dropSplitSurrogate(text, max))
  return `${text.slice(0, dropSplitSurrogate(text, max - 3))}...`
}
