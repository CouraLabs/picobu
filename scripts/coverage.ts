import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface LcovSummary {
  lines: number
  hit: number
  percent: number
}

const thresholdFromEnv = Number(Bun.env.COVERAGE_MIN)
export const COVERAGE_THRESHOLD = Number.isFinite(thresholdFromEnv) && thresholdFromEnv > 0 ? thresholdFromEnv : 50

export const parseLcov = (text: string): LcovSummary => {
  let lines = 0
  let hit = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('DA:')) continue
    const parts = line.slice('DA:'.length).split(',')
    const hits = Number(parts[1] ?? 0)
    lines += 1
    if (Number.isFinite(hits) && hits > 0) hit += 1
  }
  return { lines, hit, percent: lines > 0 ? (hit / lines) * 100 : 100 }
}

export const shouldFail = (percent: number): boolean => percent < COVERAGE_THRESHOLD

export const runCoverage = (): void => {
  const test = Bun.spawnSync({
    cmd: ['bun', 'test', 'tests', '--coverage', '--coverage-reporter=lcov'],
    env: { ...Bun.env, AGENT: '1' },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (test.exitCode !== 0) process.exit(test.exitCode ?? 1)
  const lcovPath = join(process.cwd(), 'coverage', 'lcov.info')
  if (!existsSync(lcovPath)) {
    console.error(`coverage: lcov report not found at ${lcovPath}`)
    process.exit(1)
  }
  const summary = parseLcov(readFileSync(lcovPath, 'utf8'))
  console.log(`coverage: ${summary.percent.toFixed(2)}% lines covered (${summary.hit}/${summary.lines})`)
  if (shouldFail(summary.percent)) {
    console.error(`coverage: below the ${COVERAGE_THRESHOLD}% line-coverage threshold`)
    process.exit(1)
  }
}

if (import.meta.main) runCoverage()
