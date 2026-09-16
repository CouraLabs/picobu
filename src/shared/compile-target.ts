export type CompileOs = 'darwin' | 'linux' | 'win32'
export type CompileArch = 'x64' | 'arm64'
export type CompileLibc = 'glibc' | 'musl'

export interface CompileTargetSelection {
  target: Bun.Build.CompileTarget
  libc: CompileLibc | undefined
}

export const normalizeLibc = (raw: string | undefined): CompileLibc => {
  if (raw === undefined) return 'glibc'
  const value = raw.trim().toLowerCase()
  if (value === 'glibc' || value === 'musl') return value
  throw new Error(`Unsupported libc '${raw}' (expected 'glibc' or 'musl')`)
}

// On Windows arm64, process.arch reports the emulation arch when bun runs under x64
// emulation, so the native PROCESSOR_ARCHITECTURE env var is the reliable signal.
export const resolveHostArch = (): CompileArch => {
  if (process.platform === 'win32' && process.env.PROCESSOR_ARCHITECTURE === 'ARM64') return 'arm64'
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

// A glibc-linked binary cannot start on musl systems (Alpine etc.), so linux builds need
// the host libc. ldd --version is the portable tell: musl's ldd prints "musl libc".
// Undefined means glibc or undetectable.
export const detectHostLibc = (): CompileLibc | undefined => {
  if (process.platform !== 'linux') return undefined
  try {
    const proc = Bun.spawnSync(['ldd', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    if (proc.exitCode !== 0) return undefined
    const text = `${proc.stdout.toString()}${proc.stderr.toString()}`.toLowerCase()
    return text.includes('musl') ? 'musl' : undefined
  } catch {
    return undefined
  }
}

export const resolveCompileTarget = (platform: string, arch: string, libcRaw?: string): CompileTargetSelection => {
  const libc = normalizeLibc(libcRaw)
  if (platform === 'win32' && arch === 'x64') return { target: 'bun-windows-x64', libc: undefined }
  if (platform === 'win32' && arch === 'arm64') return { target: 'bun-windows-arm64', libc: undefined }
  if (platform === 'darwin' && arch === 'arm64') return { target: 'bun-darwin-arm64', libc: undefined }
  if (platform === 'darwin' && arch === 'x64') return { target: 'bun-darwin-x64', libc: undefined }
  if (platform === 'linux' && arch === 'x64' && libc === 'musl') return { target: 'bun-linux-x64-musl', libc }
  if (platform === 'linux' && arch === 'x64') return { target: 'bun-linux-x64', libc }
  if (platform === 'linux' && arch === 'arm64' && libc === 'musl') return { target: 'bun-linux-arm64-musl', libc }
  if (platform === 'linux' && arch === 'arm64') return { target: 'bun-linux-arm64', libc }
  throw new Error(`Unsupported compile target: ${platform}-${arch}`)
}

export const defaultOutfile = (platform: string): string => (platform === 'win32' ? 'picobu.exe' : 'picobu')
