import { join } from 'node:path'
import { defaultOutfile, normalizeLibc, resolveCompileTarget } from '../src/shared/compile-target.ts'

const root = join(import.meta.dir, '..')
const argv = process.argv.slice(2)
const flagValue = (name: string): string | undefined => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  const next = argv[index + 1]
  return index >= 0 && next !== undefined && !next.startsWith('-') ? next : undefined
}

const explicitTarget = flagValue('--target')
const outfileFlag = flagValue('--outfile')
const libcFlag = flagValue('--libc') ?? process.env.OPENTUI_LIBC
const libc = normalizeLibc(libcFlag)
const selection = explicitTarget === undefined ? resolveCompileTarget(process.platform, process.arch, libc) : { target: explicitTarget as Bun.Build.CompileTarget, libc: process.platform === 'linux' ? libc : undefined }
const outfile = outfileFlag ?? join(root, 'dist', defaultOutfile(process.platform === 'win32' || selection.target.startsWith('bun-windows') ? 'win32' : process.platform))

const result = await Bun.build({
  entrypoints: [join(root, 'src/cli.ts')],
  compile: {
    target: selection.target,
    outfile,
  },
  define: selection.libc === undefined ? {} : { 'process.env.OPENTUI_LIBC': JSON.stringify(selection.libc) },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error(`Standalone build failed for ${selection.target}`)
}

console.log(`Built ${selection.target} -> ${outfile}`)
