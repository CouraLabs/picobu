import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bumpVersion } from '../src/shared/version.ts'

const root = join(import.meta.dir, '..')

export const runStep = (cmd: Array<string>, label: string): void => {
  const result = Bun.spawnSync(cmd, { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] })
  if (result.exitCode !== 0) throw new Error(`${label} failed with exit code ${result.exitCode}: ${cmd.join(' ')}`)
}

const main = async (): Promise<void> => {
  runStep(['bun', 'run', 'tsc'], 'tsc')
  runStep(['bun', 'run', 'test'], 'unit tests')

  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown } & Record<string, unknown>
  const current = String(pkg.version ?? '')
  const next = bumpVersion(current, 'build')
  pkg.version = next
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`version ${current} -> ${next}`)

  runStep(['bun', 'publish', '--access', 'public', '--cpu=*', '--os=*'], 'bun publish')

  console.log(`released @couralabs/picobu@${next}`)
  console.log('install: bunx @couralabs/picobu (or bun add -g @couralabs/picobu)')
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exit(1)
  })
}
