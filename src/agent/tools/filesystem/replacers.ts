import { logDebug } from '@shared/logger.ts'
import { createTwoFilesPatch } from 'diff'

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.65

const levenshtein = (a: string, b: string): number => {
  if (a === '' || b === '') return Math.max(a.length, b.length)
  const matrix: Array<Array<number>> = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const row = matrix[i] as Array<number>
      const prev = matrix[i - 1] as Array<number>
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost)
    }
  }
  return matrix[a.length]?.[b.length] ?? Math.max(a.length, b.length)
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n')
  const searchLines = find.split('\n')
  if (searchLines[searchLines.length - 1] === '') searchLines.pop()
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true
    for (let j = 0; j < searchLines.length; j++) {
      if ((originalLines[i + j] ?? '').trim() !== (searchLines[j] ?? '').trim()) {
        matches = false
        break
      }
    }
    if (!matches) continue
    let start = 0
    for (let k = 0; k < i; k++) start += (originalLines[k] ?? '').length + 1
    let end = start
    for (let k = 0; k < searchLines.length; k++) {
      end += (originalLines[i + k] ?? '').length
      if (k < searchLines.length - 1) end += 1
    }
    yield content.substring(start, end)
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n')
  const searchLines = find.split('\n')
  if (searchLines.length < 3) return
  if (searchLines[searchLines.length - 1] === '') searchLines.pop()
  const first = (searchLines[0] ?? '').trim()
  const last = (searchLines[searchLines.length - 1] ?? '').trim()
  const blockSize = searchLines.length
  const maxDelta = Math.max(1, Math.floor(blockSize * 0.25))
  const candidates: Array<{ start: number; end: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if ((originalLines[i] ?? '').trim() !== first) continue
    for (let j = i + 2; j < originalLines.length; j++) {
      if ((originalLines[j] ?? '').trim() === last) {
        if (Math.abs(j - i + 1 - blockSize) <= maxDelta) candidates.push({ start: i, end: j })
        break
      }
    }
  }
  if (candidates.length === 0) return
  const sliceBlock = (start: number, end: number): string => {
    let from = 0
    for (let k = 0; k < start; k++) from += (originalLines[k] ?? '').length + 1
    let to = from
    for (let k = start; k <= end; k++) {
      to += (originalLines[k] ?? '').length
      if (k < end) to += 1
    }
    return content.substring(from, to)
  }
  const similarity = (start: number, end: number): number => {
    const actual = end - start + 1
    const middle = Math.min(blockSize - 2, actual - 2)
    if (middle <= 0) return 1
    let score = 0
    for (let j = 1; j < blockSize - 1 && j < actual - 1; j++) {
      const a = (originalLines[start + j] ?? '').trim()
      const b = (searchLines[j] ?? '').trim()
      const maxLen = Math.max(a.length, b.length)
      if (maxLen === 0) continue
      score += 1 - levenshtein(a, b) / maxLen
    }
    return score / middle
  }
  if (candidates.length === 1) {
    const only = candidates[0] as { start: number; end: number }
    if (similarity(only.start, only.end) >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) yield sliceBlock(only.start, only.end)
    return
  }
  let best: { start: number; end: number } | undefined
  let bestScore = -1
  for (const candidate of candidates) {
    const score = similarity(candidate.start, candidate.end)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  if (best && bestScore >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD) yield sliceBlock(best.start, best.end)
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()
  const normalizedFind = normalize(find)
  const lines = content.split('\n')
  const escapeRegExp = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const line of lines) {
    if (normalize(line) === normalizedFind) {
      yield line
      continue
    }
    if (normalize(line).includes(normalizedFind) && normalizedFind.length > 0) {
      const words = find.trim().split(/\s+/)
      if (words.length === 0) continue
      try {
        const match = line.match(new RegExp(words.map(escapeRegExp).join('\\s+')))
        if (match) yield match[0]
      } catch (error) {
        logDebug('swallowed error', { scope: 'replacers', error })
      }
    }
  }
  const findLines = find.split('\n')
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length).join('\n')
      if (normalize(block) === normalizedFind) yield block
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const dedent = (text: string): string => {
    const lines = text.split('\n')
    const nonEmpty = lines.filter((line) => line.trim().length > 0)
    if (nonEmpty.length === 0) return text
    const min = Math.min(...nonEmpty.map((line) => (line.match(/^(\s*)/)?.[1] ?? '').length))
    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(min))).join('\n')
  }
  const normalizedFind = dedent(find)
  const contentLines = content.split('\n')
  const findLines = find.split('\n')
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n')
    if (dedent(block) === normalizedFind) yield block
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (value: string): string =>
    value.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, char: string) => {
      switch (char) {
        case 'n':
          return '\n'
        case 't':
          return '\t'
        case 'r':
          return '\r'
        case "'":
          return "'"
        case '"':
          return '"'
        case '`':
          return '`'
        case '\\':
          return '\\'
        case '\n':
          return '\n'
        case '$':
          return '$'
        default:
          return match
      }
    })
  const unescapedFind = unescapeString(find)
  if (content.includes(unescapedFind)) yield unescapedFind
  const lines = content.split('\n')
  const findLines = unescapedFind.split('\n')
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n')
    if (unescapeString(block) === unescapedFind) yield block
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let from = 0
  for (;;) {
    const index = content.indexOf(find, from)
    if (index === -1) break
    yield find
    from = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmed = find.trim()
  if (trimmed === find) return
  if (content.includes(trimmed)) yield trimmed
  const lines = content.split('\n')
  const findLines = find.split('\n')
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n')
    if (block.trim() === trimmed) yield block
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split('\n')
  if (findLines.length < 3) return
  if (findLines[findLines.length - 1] === '') findLines.pop()
  const contentLines = content.split('\n')
  const first = (findLines[0] ?? '').trim()
  const last = (findLines[findLines.length - 1] ?? '').trim()
  for (let i = 0; i < contentLines.length; i++) {
    if ((contentLines[i] ?? '').trim() !== first) continue
    for (let j = i + 2; j < contentLines.length; j++) {
      if ((contentLines[j] ?? '').trim() !== last) continue
      const blockLines = contentLines.slice(i, j + 1)
      if (blockLines.length !== findLines.length) break
      let matching = 0
      let total = 0
      for (let k = 1; k < blockLines.length - 1; k++) {
        const a = (blockLines[k] ?? '').trim()
        const b = (findLines[k] ?? '').trim()
        if (a.length > 0 || b.length > 0) {
          total++
          if (a === b) matching++
        }
      }
      if (total === 0 || matching / total >= 0.5) yield blockLines.join('\n')
      break
    }
  }
}

const REPLACERS: Array<Replacer> = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
]

const isDisproportionateMatch = (search: string, oldString: string): boolean => {
  const oldLines = oldString.split('\n').length
  const searchLines = search.split('\n').length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}

export const normalizeLineEndings = (text: string): string => text.replaceAll('\r\n', '\n')

export const detectLineEnding = (text: string): '\n' | '\r\n' => (text.includes('\r\n') ? '\r\n' : '\n')

export const convertToLineEnding = (text: string, ending: '\n' | '\r\n'): string => (ending === '\n' ? text : text.replaceAll('\n', '\r\n'))

export const replaceText = (content: string, oldString: string, newString: string, replaceAll = false): string => {
  if (oldString === newString) throw new Error('No changes to apply: oldString and newString are identical.')
  if (oldString === '') throw new Error('oldString cannot be empty when editing an existing file. Provide the exact text to replace, or use write for an intentional full-file replacement.')
  let found = false
  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      found = true
      if (isDisproportionateMatch(search, oldString)) {
        throw new Error('Refusing replacement because the matched span is much larger than oldString. Re-read the file and provide the full exact oldString for the intended replacement.')
      }
      if (replaceAll) return content.replaceAll(search, () => newString)
      if (index !== content.lastIndexOf(search)) continue
      return `${content.substring(0, index)}${newString}${content.substring(index + search.length)}`
    }
  }
  if (!found) throw new Error('Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.')
  throw new Error('Found multiple matches for oldString. Provide more surrounding context to make the match unique.')
}

export const trimDiff = (diff: string): string => {
  const lines = diff.split('\n')
  const contentLines = lines.filter((line) => (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) && !line.startsWith('---') && !line.startsWith('+++'))
  if (contentLines.length === 0) return diff
  let min = Infinity
  for (const line of contentLines) {
    const body = line.slice(1)
    if (body.trim().length > 0) min = Math.min(min, (body.match(/^(\s*)/)?.[1] ?? '').length)
  }
  if (min === Infinity || min === 0) return diff
  return lines
    .map((line) => {
      if ((line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) && !line.startsWith('---') && !line.startsWith('+++')) return (line[0] ?? '') + line.slice(1).slice(min)
      return line
    })
    .join('\n')
}

export const diffForFile = (path: string, before: string, after: string): string => trimDiff(createTwoFilesPatch(path, path, normalizeLineEndings(before), normalizeLineEndings(after), '', ''))
