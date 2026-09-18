import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin'
import pkg from '../package.json' with { type: 'json' }

export interface NpmBuildOptions {
  outDir: string
  probeDir: string
  entry: string
  probeEntry: string
  quiet: boolean
}

const root = join(import.meta.dir, '..')

export const npmExternalPackages: Array<string> = [
  '@opentui/core',
  '@opentui/solid',
  '@opentui/solid/*',
  'solid-js',
  'solid-js/*',
  'puppeteer',
  '@vscode/ripgrep',
  '@vscode/ripgrep-*',
  'web-tree-sitter',
]

export interface RuntimeAssetCopy {
  from: string
  to: string
}

export const runtimeAssetCopies = (rootDir: string): Array<RuntimeAssetCopy> => [
  { from: join(rootDir, 'src/agent/workflows/init.md'), to: 'init.md' },
  { from: join(rootDir, 'src/agent/workflows/review.md'), to: 'review.md' },
]

export interface BuildOutputLike {
  kind: string
  path: string
}

export const selectEntryArtifact = (outputs: Array<BuildOutputLike>): string => {
  const entry = outputs.find((o) => o.kind === 'entry-point')
  if (!entry) throw new Error('build produced no entry point')
  return entry.path
}

export const parseNpmBuildArgs = (argv: Array<string>): NpmBuildOptions => {
  const readValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    if (index < 0) return undefined
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    return value
  }
  const outDir = resolve(root, readValue('--out-dir') ?? 'dist')
  const probeDir = resolve(root, readValue('--probe-dir') ?? '.tmp/npm-probe')
  const entry = resolve(root, readValue('--entry') ?? 'src/cli.ts')
  const probeEntry = resolve(root, readValue('--probe-entry') ?? 'scripts/npm-asset-probe.ts')
  const quiet = argv.includes('--quiet')
  return { outDir, probeDir, entry, probeEntry, quiet }
}

export const buildBundle = async (entryPath: string, outDirPath: string): Promise<string> => {
  const result = await Bun.build({
    conditions: ['bun', 'node'],
    tsconfig: join(root, 'tsconfig.json'),
    plugins: [createSolidTransformPlugin()],
    format: 'esm',
    target: 'bun',
    minify: true,
    sourcemap: 'none',
    external: npmExternalPackages,
    entrypoints: [entryPath],
    outdir: outDirPath,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`build failed with ${result.logs.length} error(s)`)
  }
  return selectEntryArtifact(result.outputs)
}

export const writeRuntimeAssets = (outDir: string): void => {
  mkdirSync(outDir, { recursive: true })
  for (const asset of runtimeAssetCopies(root)) {
    if (!statSync(asset.from, { throwIfNoEntry: false })) throw new Error(`missing runtime asset: ${asset.from}`)
    copyFileSync(asset.from, join(outDir, asset.to))
  }
}

const formatMb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const main = async (): Promise<void> => {
  const options = parseNpmBuildArgs(process.argv.slice(2))
  const colors = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !options.quiet
  const dim = (value: string): string => (colors ? `\x1b[2m${value}\x1b[0m` : value)
  const green = (value: string): string => (colors ? `\x1b[32m${value}\x1b[0m` : value)
  const info = (message: string): void => {
    if (!options.quiet) console.log(`  ${dim('·')} ${message}`)
  }
  const done = (message: string): void => {
    if (!options.quiet) console.log(`  ${green('✓')} ${message}`)
  }

  const version = String(pkg.version ?? '')
  if (!options.quiet) console.log(`${dim(`picobu ${version}`)} building npm bundle → ${join(options.outDir, 'cli.js')}`)

  chmodSync(join(root, 'bin/picobu.mjs'), 0o755)

  const bundlePath = await buildBundle(options.entry, options.outDir)
  writeRuntimeAssets(options.outDir)
  const size = statSync(bundlePath).size
  info(`bundle ${bundlePath} (${formatMb(size)})`)

  const smokeDir = mkdtempSync(join(tmpdir(), 'picobu-npm-smoke-'))
  try {
    const smoke = Bun.spawnSync(['bun', bundlePath, '--version'], { cwd: smokeDir, stdout: 'pipe', stderr: 'pipe' })
    const smokeVersion = smoke.stdout.toString().trim()
    if (smoke.exitCode !== 0 || !/^\d+\.\d+\.\d+$/.test(smokeVersion)) {
      const stderr = smoke.stderr.toString().trim()
      throw new Error(`smoke test failed (bun ${bundlePath} --version): ${stderr || `exit code ${smoke.exitCode}`}`)
    }
    if (smokeVersion !== version) throw new Error(`packed version ${smokeVersion} does not match package.json ${version}`)
    info(`smoke test (--version) → ${smokeVersion}`)
  } finally {
    rmSync(smokeDir, { recursive: true, force: true })
  }

  rmSync(options.probeDir, { recursive: true, force: true })
  const probeBundlePath = await buildBundle(options.probeEntry, options.probeDir)
  writeRuntimeAssets(options.probeDir)
  const probe = Bun.spawnSync(['bun', probeBundlePath], { cwd: options.probeDir, stdout: 'pipe', stderr: 'pipe' })
  const probeOutput = `${probe.stdout.toString()}${probe.stderr.toString()}`.trim()
  if (probe.exitCode !== 0 || !probeOutput.includes('probe ok')) {
    throw new Error(`runtime asset probe failed: ${probeOutput || `exit code ${probe.exitCode}`}`)
  }
  done(`runtime assets ok (${probeOutput.split('\n')[0]})`)
  done(`built ${bundlePath}`)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exit(1)
  })
}
