import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bumpVersion, type VersionKind } from '../src/shared/version.ts'

const root = join(import.meta.dir, '..')

export interface PublishOptions {
  kind: VersionKind
  ci: boolean
  skipChecks: boolean
  skipGit: boolean
  assumeYes: boolean
}

export interface InstallScriptStamp {
  picobuVersion: string
  puppeteerVersion: string
}

export const parsePublishArgs = (argv: Array<string>): PublishOptions => {
  const options: PublishOptions = { kind: 'build', ci: false, skipChecks: false, skipGit: false, assumeYes: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--feature' || arg === '--minor' || arg === '-f') {
      options.kind = 'feature'
    } else if (arg === '--build') {
      options.kind = 'build'
    } else if (arg === '--bump') {
      const value = argv[i + 1]
      if (value !== 'build' && value !== 'feature') throw new Error(`--bump requires "build" or "feature" (got "${value ?? ''}")`)
      options.kind = value
      i++
    } else if (arg === '--ci') {
      options.ci = true
    } else if (arg === '--skip-checks') {
      options.skipChecks = true
    } else if (arg === '--skip-git') {
      options.skipGit = true
    } else if (arg === '--yes' || arg === '-y') {
      options.assumeYes = true
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (options.ci) options.assumeYes = true
  return options
}

export const normalizeDependencyRange = (range: string): string => range.replace(/^[\^~><=\s]+/, '')

const shMarkers = {
  picobu: /^PICOBU_VERSION_DEFAULT="[^"]*"$/m,
  puppeteer: /^PUPPETEER_VERSION_DEFAULT="[^"]*"$/m,
}
const ps1Markers = {
  picobu: /^\$PicobuVersionDefault = '[^']*'$/m,
  puppeteer: /^\$PuppeteerVersionDefault = '[^']*'$/m,
}

const replaceOnce = (content: string, pattern: RegExp, replacement: string): string => {
  const matches = content.match(new RegExp(pattern.source, 'gm'))
  if (!matches || matches.length !== 1) throw new Error(`install script marker not found: ${pattern.source}`)
  return content.replace(pattern, replacement)
}

export const stampInstallScripts = (content: string, stamp: InstallScriptStamp, kind: 'sh' | 'ps1'): string => {
  const markers = kind === 'sh' ? shMarkers : ps1Markers
  const picobuReplacement = kind === 'sh' ? `PICOBU_VERSION_DEFAULT="${stamp.picobuVersion}"` : `$PicobuVersionDefault = '${stamp.picobuVersion}'`
  const puppeteerReplacement = kind === 'sh' ? `PUPPETEER_VERSION_DEFAULT="${stamp.puppeteerVersion}"` : `$PuppeteerVersionDefault = '${stamp.puppeteerVersion}'`
  let out = replaceOnce(content, markers.picobu, picobuReplacement)
  out = replaceOnce(out, markers.puppeteer, puppeteerReplacement)
  return out
}

export const packListFromOutput = (output: string): Array<string> => {
  const out: Array<string> = []
  for (const match of output.matchAll(/^packed \S+ (.+)$/gm)) out.push(match[1] ?? '')
  return out
}

export const assertPackList = (files: Array<string>, version: string): void => {
  const required = ['package.json', 'bin/picobu.mjs', 'dist/cli.js', 'dist/init.md', 'dist/review.md']
  const missing = required.filter((f) => !files.includes(f))
  if (missing.length > 0) throw new Error(`pack output is missing required files for ${version}: ${missing.join(', ')}`)
  const hasWasm = files.some((f) => f.startsWith('dist/') && f.endsWith('.wasm'))
  const hasScm = files.some((f) => f.startsWith('dist/') && f.endsWith('.scm'))
  if (!hasWasm || !hasScm) throw new Error(`pack output for ${version} is missing parser assets under dist/ (wasm: ${hasWasm}, scm: ${hasScm})`)
  const forbiddenPrefixes = ['src/', 'tests/', 'scripts/', '.agents/', '.github/']
  const leaked = files.filter((f) => forbiddenPrefixes.some((p) => f.startsWith(p)))
  if (leaked.length > 0) throw new Error(`pack output for ${version} leaks source files: ${leaked.join(', ')}`)
}

const runInherited = (cmd: string[]): void => {
  const proc = Bun.spawnSync(cmd)
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(' ')} exited with code ${proc.exitCode}`)
}

const assertCleanTree = (skipGit: boolean): void => {
  if (skipGit) {
    console.warn('warning: --skip-git set; skipping the clean-tree check')
    return
  }
  const status = Bun.spawnSync(['git', 'status', '--porcelain'], { stdout: 'pipe', stderr: 'pipe' })
  if (status.exitCode !== 0) throw new Error(`git status failed: ${status.stderr.toString().trim()}`)
  if (status.stdout.toString().trim().length > 0) throw new Error('working tree is dirty — commit or stash first (use --skip-git to override)')
}

const main = async (): Promise<void> => {
  const options = parsePublishArgs(process.argv.slice(2))

  assertCleanTree(options.skipGit)

  if (!options.skipChecks) {
    runInherited(['bun', 'run', 'lint'])
    runInherited(['bun', 'run', 'tsc'])
    runInherited(['bun', 'run', 'test'])
  }

  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown } & Record<string, unknown>
  const current = String(pkg.version ?? '')
  const next = bumpVersion(current, options.kind)
  pkg.version = next
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`version ${current} -> ${next}`)

  const puppeteerVersion = normalizeDependencyRange(String((pkg.dependencies as Record<string, string> | undefined)?.puppeteer ?? ''))
  const stamp: InstallScriptStamp = { picobuVersion: next, puppeteerVersion }
  for (const [file, kind] of [['scripts/install.sh', 'sh'], ['scripts/install.ps1', 'ps1']] as const) {
    const path = join(root, file)
    writeFileSync(path, stampInstallScripts(readFileSync(path, 'utf8'), stamp, kind))
  }
  console.log(`install scripts stamped (puppeteer ${puppeteerVersion})`)

  runInherited(['bun', 'scripts/build-npm.ts'])

  const pack = Bun.spawnSync(['bun', 'pm', 'pack', '--dry-run'], { stdout: 'pipe', stderr: 'pipe' })
  if (pack.exitCode !== 0) throw new Error(`bun pm pack --dry-run failed: ${pack.stderr.toString().trim()}`)
  assertPackList(packListFromOutput(pack.stdout.toString()), next)

  const baked = Bun.spawnSync(['bun', join(root, 'dist/cli.js'), '--version'], { stdout: 'pipe', stderr: 'pipe' })
  const bakedVersion = baked.stdout.toString().trim()
  if (baked.exitCode !== 0 || bakedVersion !== next) throw new Error(`baked bundle version ${bakedVersion} does not match ${next}`)

  if (options.ci) {
    if (!process.env.NPM_TOKEN) throw new Error('NPM_TOKEN is required in --ci mode')
    const npmrcPath = join(root, '.npmrc')
    writeFileSync(npmrcPath, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n')
    try {
      runInherited(['bun', 'publish', '--access', 'public'])
    } finally {
      rmSync(npmrcPath, { force: true })
    }
  } else {
    runInherited(['bun', 'publish', '--access', 'public'])
  }

  if (!options.skipGit) {
    if (!options.assumeYes) {
      if (!process.stdin.isTTY) throw new Error('refusing to push without --yes')
      const readline = await import('node:readline/promises')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = (await rl.question(`release: commit, tag and push v${next}? [y/N] `)).trim().toLowerCase()
      rl.close()
      if (answer !== 'y' && answer !== 'yes') {
        console.log('skipping commit, tag and push')
        console.log(`released @couralabs/picobu@${next} (local only)`)
        return
      }
    }
    runInherited(['git', 'add', '-A'])
    runInherited(['git', 'commit', '-m', `chore: release v${next}`])
    runInherited(['git', 'tag', `v${next}`])
    runInherited(['git', 'push', '--follow-tags'])
  }

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
