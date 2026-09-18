import { existsSync } from 'node:fs'
import { BUILTIN_WORKFLOWS } from '@agent/workflows/builtin.ts'
import { getParsers } from '@wrappers/parsers/assets.ts'

const parsers = await getParsers()
const missing: Array<string> = []
for (const parser of parsers) {
  if (!existsSync(parser.wasm)) missing.push(parser.wasm)
  for (const query of parser.queries.highlights) if (!existsSync(query)) missing.push(query)
}
if (missing.length > 0) {
  console.error(`missing parser assets: ${missing.join(', ')}`)
  process.exit(1)
}
if (BUILTIN_WORKFLOWS.length !== 2) {
  console.error(`expected 2 builtin workflows, found ${BUILTIN_WORKFLOWS.length}`)
  process.exit(1)
}
console.log(`probe ok: ${parsers.length} parsers, ${BUILTIN_WORKFLOWS.length} builtin workflows`)
