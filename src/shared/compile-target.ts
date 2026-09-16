export type CompileOs = 'darwin' | 'linux' | 'win32'
export type CompileArch = 'x64' | 'arm64'
export type CompileLibc = 'glibc' | 'musl'

export interface CompileTargetSelection {
  target: Bun.Build.CompileTarget
  libc: CompileLibc | undefined
}

export const normalizeLibc = (raw: string | undefined): CompileLibc => (raw === 'musl' ? 'musl' : 'glibc')

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
