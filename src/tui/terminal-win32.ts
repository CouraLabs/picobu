import { dlopen, ptr } from 'bun:ffi'
import type { ReadStream } from 'node:tty'

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001

const kernel = () =>
  dlopen('kernel32.dll', {
    GetStdHandle: { args: ['i32'], returns: 'ptr' },
    GetConsoleMode: { args: ['ptr', 'ptr'], returns: 'i32' },
    SetConsoleMode: { args: ['ptr', 'u32'], returns: 'i32' },
    FlushConsoleInputBuffer: { args: ['ptr'], returns: 'i32' },
  })

type Kernel = ReturnType<typeof kernel>

let k32: Kernel | undefined

const load = (): Kernel | undefined => {
  if (process.platform !== 'win32') return undefined
  try {
    k32 ??= kernel()
    return k32
  } catch {
    return undefined
  }
}

const readMode = (k: Kernel, handle: ReturnType<Kernel['symbols']['GetStdHandle']>, buf: Uint32Array): number | undefined => (k.symbols.GetConsoleMode(handle, ptr(buf)) === 0 ? undefined : buf[0])

export const win32DisableProcessedInput = (): void => {
  const k = load()
  if (!k) return
  if (!process.stdin.isTTY) return
  const buf = new Uint32Array(1)
  const handle = k.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const mode = readMode(k, handle, buf)
  if (mode === undefined || (mode & ENABLE_PROCESSED_INPUT) === 0) return
  k.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

export const win32FlushInputBuffer = (): void => {
  const k = load()
  if (!k) return
  if (!process.stdin.isTTY) return
  k.symbols.FlushConsoleInputBuffer(k.symbols.GetStdHandle(STD_INPUT_HANDLE))
}

let unhook: (() => void) | undefined

export const win32InstallCtrlCGuard = (): (() => void) | undefined => {
  const k = load()
  if (!k) return undefined
  if (!process.stdin.isTTY) return undefined
  if (unhook) return unhook

  const stdin = process.stdin as ReadStream
  const original = stdin.setRawMode
  const buf = new Uint32Array(1)
  const handle = k.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const initial = readMode(k, handle, buf)
  if (initial === undefined) return undefined

  const enforce = (): void => {
    const mode = readMode(k, handle, buf)
    if (mode === undefined || (mode & ENABLE_PROCESSED_INPUT) === 0) return
    k.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  const later = (): void => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: ReadStream['setRawMode'] | undefined
  if (typeof original === 'function') {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      later()
      return result
    }
    stdin.setRawMode = wrapped
  }

  later()

  const interval = setInterval(enforce, 100)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) stdin.setRawMode = original

    k.symbols.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
