import { mkdirSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export const atomicWriteFile = async (path: string, data: string, mode?: number): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    await Bun.write(tmp, data, mode !== undefined ? { mode } : {})
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}
