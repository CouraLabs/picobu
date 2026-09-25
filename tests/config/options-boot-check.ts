import { mkdirSync, writeFileSync } from 'node:fs'

const systemDir = process.env.PICOBU_SYSTEM_DIR ?? ''
const payload = Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8')

mkdirSync(systemDir, { recursive: true })
writeFileSync(`${systemDir}/options.json`, payload)

const run = async (): Promise<void> => {
  try {
    await import(`../../src/config/options.ts?t=${Date.now()}`)
    console.log(JSON.stringify({ ok: true }))
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  }
}

await run()
