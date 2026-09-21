import { createSignal } from 'solid-js'

export interface BangOutput {
  id: number
  command: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
  outputPath?: string
  durationMs: number
  startedAt: number
}

export const BANG_OUTPUT_TTL_MS = 5 * 60 * 1000

const [currentBangOutput, setCurrentBangOutput] = createSignal<BangOutput | null>(null)

let nextBangId = 1

export const bangOutput = () => currentBangOutput()

export const setBangOutput = (item: BangOutput | null): void => {
  setCurrentBangOutput(item)
}

export const clearBangOutput = (): void => {
  setBangOutput(null)
}

export const allocBangId = (): number => nextBangId++
