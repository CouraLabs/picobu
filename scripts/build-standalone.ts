import { join } from 'node:path'
import {
  defaultOutfile,
  detectHostLibc,
  normalizeLibc,
  resolveCompileTarget,
  resolveHostArch,
  type CompileLibc,
  type CompileTargetSelection,
} from '../src/shared/compile-target.ts'

const root = join(import.meta.dir, '..')
const argv = process.argv.slice(2)
const flagValue = (name: string): string | undefined => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct !== undefined) {
    const value = direct.slice(name.length + 1)
    return value.length > 0 ? value : undefined
  }
  const index = argv.indexOf(name)
  const next = argv[index + 1]
  return index >= 0 && next !== undefined && !next.startsWith('-') && next.length > 0 ? next : undefined
}

// bun >= 1.3.0 is required for OpenTUI standalone builds. The check lives here so
// install.sh, install.ps1 and plain `bun run build` all share a single gate.
const BUN_FLOOR_MAJOR = 1
const BUN_FLOOR_MINOR = 3
const bunVersion = Bun.version ?? '0.0.0'
const [bunMajor, bunMinor] = bunVersion.split('.').map((part) => Number.parseInt(part, 10))
if ((bunMajor ?? 0) < BUN_FLOOR_MAJOR || ((bunMajor ?? 0) === BUN_FLOOR_MAJOR && (bunMinor ?? 0) < BUN_FLOOR_MINOR)) {
  console.error(
    `bun >= ${BUN_FLOOR_MAJOR}.${BUN_FLOOR_MINOR}.0 is required for OpenTUI standalone builds (found ${bunVersion}). Upgrade bun, then re-run.`,
  )
  process.exit(1)
}

const explicitTarget = flagValue('--target')
const outfileFlag = flagValue('--outfile')
const flagLibc = flagValue('--libc') === undefined ? undefined : normalizeLibc(flagValue('--libc'))
const envLibc = process.env.OPENTUI_LIBC === undefined ? undefined : normalizeLibc(process.env.OPENTUI_LIBC)

// For an explicit target the libc comes from the target suffix, not the build host,
// so cross-builds bake the right OPENTUI_LIBC define.
const targetLibc = (target: string): CompileLibc | undefined => {
  if (!target.startsWith('bun-linux')) return undefined
  return target.endsWith('-musl') ? 'musl' : 'glibc'
}

const selection: CompileTargetSelection =
  explicitTarget === undefined
    ? resolveCompileTarget(process.platform, resolveHostArch(), flagLibc ?? envLibc ?? detectHostLibc())
    : buildExplicitSelection(explicitTarget)

function buildExplicitSelection(target: string): CompileTargetSelection {
  const libc = targetLibc(target)
  if (flagLibc !== undefined && flagLibc !== libc) {
    throw new Error(`--libc ${flagLibc} does not match target ${target}`)
  }
  return { target: target as Bun.Build.CompileTarget, libc }
}

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
