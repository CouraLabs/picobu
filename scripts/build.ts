#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin'
import { defaultOutfile, detectHostLibc, resolveCompileTarget, resolveHostArch } from '../src/shared/compile-target.ts'
import pkg from '../package.json' with { type: 'json' }

export interface BuildScriptOptions {
  outDir: string
  entry: string
  quiet: boolean
}

const root = join(import.meta.dir, '..')

const useColor = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

export const parseBuildArgs = (argv: Array<string>): BuildScriptOptions => {
  const readValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    if (index < 0) return undefined
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    return value
  }
  const outDir = resolve(root, readValue('--out-dir') ?? 'dist')
  const entry = resolve(root, readValue('--entry') ?? 'src/cli.ts')
  const quiet = argv.includes('--quiet')
  return { outDir, entry, quiet }
}

export const binaryPathFor = (outDir: string, platform: string): string => join(outDir, defaultOutfile(platform))

const formatMb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const buildBinary = async (): Promise<void> => {
  const { outDir, entry, quiet } = parseBuildArgs(process.argv.slice(2))
  const colors = useColor() && !quiet
  const dim = (value: string): string => (colors ? `\x1b[2m${value}\x1b[0m` : value)
  const green = (value: string): string => (colors ? `\x1b[32m${value}\x1b[0m` : value)
  const info = (message: string): void => {
    if (!quiet) console.log(`  ${dim('·')} ${message}`)
  }
  const done = (message: string): void => {
    if (!quiet) console.log(`  ${green('✓')} ${message}`)
  }

  const version = String(pkg.version ?? '')
  const { target } = resolveCompileTarget(process.platform, resolveHostArch(), detectHostLibc())
  const outfile = binaryPathFor(outDir, process.platform)
  const startedAt = Date.now()

  if (!quiet) console.log(`${dim(`picobu ${version}`)} building → ${outfile} ${dim(`(${target})`)}`)
  mkdirSync(outDir, { recursive: true })

  const result = await Bun.build({
    conditions: ['bun', 'node'],
    tsconfig: join(root, 'tsconfig.json'),
    plugins: [createSolidTransformPlugin()],
    format: 'esm',
    minify: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target,
      outfile,
      windows: {},
    },
    entrypoints: [entry],
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`build failed with ${result.logs.length} error(s)`)
  }

  const size = (await Bun.file(outfile).stat()).size
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  done(`built ${outfile} ${dim(`(${formatMb(size)}, ${seconds}s)`)}`)
}

if (import.meta.main) {
  buildBinary().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exit(1)
  })
}
