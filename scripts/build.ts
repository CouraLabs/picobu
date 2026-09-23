#!/usr/bin/env bun
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSolidTransformPlugin } from '@opentui/solid/bun-plugin'
import pkg from '../package.json' with { type: 'json' }

const root = join(import.meta.dir, '..')

export const NATIVE_EXTERNALS = ['@opentui/core-*', '@vscode/ripgrep*']

export const RUNTIME_ASSETS = [
  { from: 'src/agent/prompts/ask.md', to: 'ask.md' },
  { from: 'src/agent/prompts/grill.md', to: 'grill.md' },
  { from: 'src/agent/prompts/coder.md', to: 'coder.md' },
  { from: 'src/agent/prompts/plan.md', to: 'plan.md' },
  { from: 'src/agent/prompts/persistent.md', to: 'persistent.md' },
  { from: 'src/agent/prompts/executor.md', to: 'executor.md' },
  { from: 'src/agent/prompts/explorer.md', to: 'explorer.md' },
  { from: 'src/agent/prompts/reviewer.md', to: 'reviewer.md' },
  { from: 'src/agent/prompts/debugger.md', to: 'debugger.md' },
  { from: 'src/agent/workflows/init.md', to: 'init.md' },
  { from: 'src/agent/workflows/review.md', to: 'review.md' },
]

const main = async (): Promise<void> => {
  const outDir = resolve(root, 'dist')
  const entry = resolve(root, 'src/cli.ts')
  mkdirSync(outDir, { recursive: true })
  const result = await Bun.build({
    conditions: ['bun', 'node'],
    tsconfig: join(root, 'tsconfig.json'),
    plugins: [createSolidTransformPlugin()],
    format: 'esm',
    target: 'bun',
    minify: true,
    sourcemap: 'none',
    packages: 'bundle',
    external: NATIVE_EXTERNALS,
    entrypoints: [entry],
    outdir: outDir,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`build failed with ${result.logs.length} error(s)`)
  }
  for (const asset of RUNTIME_ASSETS) copyFileSync(join(root, asset.from), join(outDir, asset.to))
  const version = String(pkg.version ?? '')
  const smokeDir = mkdtempSync(join(tmpdir(), 'picobu-build-smoke-'))
  try {
    const smoke = Bun.spawnSync(['bun', join(outDir, 'cli.js'), '--version'], { cwd: smokeDir, stdout: 'pipe', stderr: 'pipe' })
    const smokeVersion = smoke.stdout.toString().trim()
    if (smoke.exitCode !== 0 || smokeVersion !== version) {
      throw new Error(`smoke test failed (want ${version}, got ${smokeVersion || `exit ${smoke.exitCode}`}): ${smoke.stderr.toString().trim()}`)
    }
  } finally {
    rmSync(smokeDir, { recursive: true, force: true })
  }
  console.log(`built dist/cli.js ${version}`)
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exit(1)
  })
}
