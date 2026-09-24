export const DOOM_LOOP_WINDOW = 10
export const DOOM_LOOP_THRESHOLD = 0.95
export const DOOM_LOOP_TOOL_WINDOW = 3
export const DOOM_LOOP_TEXT_STEER = 'Doom loop detected, same message content. Review and continue.'
export const DOOM_LOOP_TOOL_STEER = 'Doom loop detected, repeated identical tool calls. Review and continue.'

export interface DoomLoopDetection {
  triggered: boolean
  runLength: number
}

export interface ToolCallLike {
  toolName: string
  input: unknown
}

export interface TextRunOptions {
  window?: number
  threshold?: number
}

export interface ToolRunOptions {
  window?: number
}

export interface DoomLoopOptions {
  window?: number
  threshold?: number
  toolWindow?: number
}

export interface DoomLoopInput {
  texts: Array<string>
  toolCalls: Array<ToolCallLike>
}

export interface DoomLoopObservation {
  steer?: string
  halt: boolean
  reason?: 'text' | 'tool'
}

export interface DoomLoopGuard {
  observe: (input: DoomLoopInput) => DoomLoopObservation
  isHalted: () => boolean
  reset: () => void
}

const toTokenSet = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  )

const overlap = (a: Set<string>, b: Set<string>): number => {
  const min = Math.min(a.size, b.size)
  if (min === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / min
}

const serializeInput = (input: unknown): string => {
  try {
    return JSON.stringify(input) ?? ''
  } catch {
    return String(input)
  }
}

const sameToolCall = (a: ToolCallLike, b: ToolCallLike): boolean => a.toolName === b.toolName && serializeInput(a.input) === serializeInput(b.input)

export const detectDoomLoop = (texts: Array<string>, options?: TextRunOptions): DoomLoopDetection => {
  const window = options?.window ?? DOOM_LOOP_WINDOW
  const threshold = options?.threshold ?? DOOM_LOOP_THRESHOLD
  const kept = texts.filter((text) => text.trim().length > 0)
  const run = kept.slice(-window)
  if (run.length < window) return { triggered: false, runLength: run.length }
  const tokenSets = run.map((text) => toTokenSet(text))
  let runLength = 1
  for (let i = tokenSets.length - 1; i >= 1; i--) {
    const current = tokenSets[i]
    const previous = tokenSets[i - 1]
    if (!current || !previous || overlap(current, previous) < threshold) break
    runLength += 1
  }
  return { triggered: runLength >= window, runLength }
}

export const detectRepeatedToolCalls = (toolCalls: Array<ToolCallLike>, options?: ToolRunOptions): DoomLoopDetection => {
  const window = options?.window ?? DOOM_LOOP_TOOL_WINDOW
  if (toolCalls.length < window) return { triggered: false, runLength: toolCalls.length }
  const run = toolCalls.slice(-window)
  let runLength = 1
  for (let i = run.length - 1; i >= 1; i--) {
    const current = run[i]
    const previous = run[i - 1]
    if (!current || !previous || !sameToolCall(current, previous)) break
    runLength += 1
  }
  return { triggered: runLength >= window, runLength }
}

export const createDoomLoopGuard = (options?: DoomLoopOptions): DoomLoopGuard => {
  const textOptions: TextRunOptions | undefined = options ? { window: options.window, threshold: options.threshold } : undefined
  const toolOptions: ToolRunOptions | undefined = options ? { window: options.toolWindow } : undefined
  let textStrike = 0
  let toolStrike = 0
  let halted = false
  const clear = (): void => {
    textStrike = 0
    toolStrike = 0
    halted = false
  }
  return {
    observe: ({ texts, toolCalls }) => {
      if (texts.length === 0 && toolCalls.length === 0) clear()
      const textHit = detectDoomLoop(texts, textOptions).triggered
      const toolHit = detectRepeatedToolCalls(toolCalls, toolOptions).triggered
      textStrike = textHit ? textStrike + 1 : 0
      toolStrike = toolHit ? toolStrike + 1 : 0
      if (textStrike >= 2 || toolStrike >= 2) {
        halted = true
        return { halt: true, reason: textStrike >= 2 ? 'text' : 'tool' }
      }
      if (textStrike === 1) return { steer: DOOM_LOOP_TEXT_STEER, halt: false }
      if (toolStrike === 1) return { steer: DOOM_LOOP_TOOL_STEER, halt: false }
      return { halt: false }
    },
    isHalted: () => halted,
    reset: () => clear(),
  }
}
