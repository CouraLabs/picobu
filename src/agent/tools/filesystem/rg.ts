import { existsSync } from 'node:fs'
import { chmod, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface FileImportModule {
  readonly default: string
}

const rgBinary = process.platform === 'win32' ? 'rg.exe' : 'rg'
const platformKey = `${process.platform}-${process.arch}`

const platformLoaders: Record<string, () => Promise<FileImportModule>> = {
  'darwin-arm64': () => import('@vscode/ripgrep-darwin-arm64/bin/rg' as string, { with: { type: 'file' } }),
  'darwin-x64': () => import('@vscode/ripgrep-darwin-x64/bin/rg' as string, { with: { type: 'file' } }),
  'linux-arm': () => import('@vscode/ripgrep-linux-arm/bin/rg' as string, { with: { type: 'file' } }),
  'linux-arm64': () => import('@vscode/ripgrep-linux-arm64/bin/rg' as string, { with: { type: 'file' } }),
  'linux-ia32': () => import('@vscode/ripgrep-linux-ia32/bin/rg' as string, { with: { type: 'file' } }),
  'linux-ppc64': () => import('@vscode/ripgrep-linux-ppc64/bin/rg' as string, { with: { type: 'file' } }),
  'linux-s390x': () => import('@vscode/ripgrep-linux-s390x/bin/rg' as string, { with: { type: 'file' } }),
  'linux-x64': () => import('@vscode/ripgrep-linux-x64/bin/rg' as string, { with: { type: 'file' } }),
  'win32-arm64': () => import('@vscode/ripgrep-win32-arm64/bin/rg.exe' as string, { with: { type: 'file' } }),
  'win32-ia32': () => import('@vscode/ripgrep-win32-ia32/bin/rg.exe' as string, { with: { type: 'file' } }),
  'win32-x64': () => import('@vscode/ripgrep-win32-x64/bin/rg.exe' as string, { with: { type: 'file' } }),
}

const isBunfsPath = (path: string): boolean => path.includes('$bunfs') || /^B:[\\/]~BUN/i.test(path)

const systemDir = process.env.PICOBU_SYSTEM_DIR?.trim() || join(homedir(), '.picobu')

const materializeBundledRg = async (bundledPath: string): Promise<string> => {
  const binDir = join(systemDir, 'bin')
  const dest = join(binDir, rgBinary)
  const tmp = `${dest}.tmp-${process.pid}`
  try {
    await Bun.write(tmp, Bun.file(bundledPath))
    await chmod(tmp, 0o755)
    await rename(tmp, dest)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  return dest
}

const existingMaterializedRg = (): string | undefined => {
  const dest = join(systemDir, 'bin', rgBinary)
  return existsSync(dest) ? dest : undefined
}

const fallbackRgPath = async (): Promise<string> => {
  const { rgPath } = await import('@vscode/ripgrep')
  return rgPath
}

let resolved: Promise<string> | undefined

export const resolveRgPath = (): Promise<string> => {
  resolved ??= (async () => {
    const loader = platformLoaders[platformKey]
    if (!loader) return fallbackRgPath()
    try {
      const bundledPath = (await loader()).default
      if (typeof bundledPath !== 'string' || bundledPath.length === 0) return fallbackRgPath()
      if (!isBunfsPath(bundledPath)) return bundledPath
      return await materializeBundledRg(bundledPath)
    } catch {
      resolved = undefined
      return existingMaterializedRg() ?? fallbackRgPath()
    }
  })()
  return resolved
}
