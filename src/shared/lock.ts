import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const POLL_INTERVAL_MS = 100

let lockDir = `${homedir()}/.picobu`
export const initLockDir = (systemDir: string): void => {
  lockDir = systemDir
}
const ourPid = process.pid
export interface LockHandle {
  path: string
  release: () => void
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
function assertSafeLockPath(path: string): void {
  if (path.includes('\t') || path.includes('\n') || path.includes('\r')) {
    throw new Error(`Refusing to lock path with control characters: ${JSON.stringify(path)}`)
  }
}
const holdersRoot = (): string => join(lockDir, 'locks')
const holderDirFor = (path: string): string => join(holdersRoot(), createHash('sha256').update(path).digest('hex'))
const readHolderPid = (dir: string): number | undefined => {
  try {
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}
async function acquireCrossProcess(dir: string): Promise<void> {
  mkdirSync(holdersRoot(), { recursive: true })
  for (;;) {
    try {
      mkdirSync(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error
      let pid = readHolderPid(dir)
      if (pid === undefined) {
        await sleep(POLL_INTERVAL_MS)
        pid = readHolderPid(dir)
      }
      if (pid === undefined || !isAlive(pid)) {
        rmSync(dir, { recursive: true, force: true })
        continue
      }
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    try {
      writeFileSync(join(dir, 'pid'), String(ourPid), 'utf8')
    } catch (error) {
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
    return
  }
}
const inProcessGates = new Map<string, Promise<void>>()
async function waitForInProcessTurn(path: string): Promise<() => void> {
  const previous = inProcessGates.get(path) ?? Promise.resolve()
  let releaseGate: () => void = () => {}
  const gate = new Promise<void>((gateResolve) => (releaseGate = gateResolve))
  const current = previous.then(() => gate)
  inProcessGates.set(path, current)
  await previous
  return () => {
    releaseGate()
    if (inProcessGates.get(path) === current) {
      inProcessGates.delete(path)
    }
  }
}
const lockNesting = new AsyncLocalStorage<Set<string>>()
export async function acquireLock(filePath: string): Promise<LockHandle> {
  assertSafeLockPath(filePath)
  const path = resolve(filePath)
  assertSafeLockPath(path)
  const releaseInProcess = await waitForInProcessTurn(path)
  const dir = holderDirFor(path)
  let settled = false
  const guardedRelease = () => {
    if (settled) return
    settled = true
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
    releaseInProcess()
  }
  try {
    await acquireCrossProcess(dir)
    return {
      path,
      release: guardedRelease,
    }
  } catch (error) {
    guardedRelease()
    throw error
  }
}
export async function withLock<TValue>(filePath: string, fn: () => Promise<TValue>): Promise<TValue> {
  const path = resolve(filePath)
  assertSafeLockPath(path)
  const nesting = lockNesting.getStore()
  if (nesting?.has(path)) {
    return await fn()
  }
  const lock = await acquireLock(path)
  try {
    const active = lockNesting.getStore()
    if (active) {
      active.add(path)
      try {
        return await fn()
      } finally {
        active.delete(path)
      }
    }
    return await lockNesting.run(new Set([path]), () => fn())
  } finally {
    lock.release()
  }
}
