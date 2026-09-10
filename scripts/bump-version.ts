import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bumpVersion, type VersionKind } from '../src/shared/version.ts'

const root = join(import.meta.dir, '..')
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown } & Record<string, unknown>
const current = String(pkg.version ?? '')

const args = new Set(process.argv.slice(2))
const kind: VersionKind = args.has('--feature') || args.has('--minor') || args.has('-f') ? 'feature' : 'build'

const next = bumpVersion(current, kind)
pkg.version = next
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`${current} -> ${next}`)
