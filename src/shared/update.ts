export interface UpdateLaunchPlan {
  sessionId?: string
  cwd?: string
}

export const updateInstallCommand = (): Array<string> => ['bun', 'add', '-g', '@couralabs/picobu', '--force', '--trust']

export const buildUpdateHelperScript = (plan: UpdateLaunchPlan, pid: number): string => {
  const sessionId = plan.sessionId ?? null
  const cwd = plan.cwd ?? null
  return `
const pid = ${pid}
const sessionId = ${JSON.stringify(sessionId)}
const cwd = ${JSON.stringify(cwd)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = () => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
while (alive()) await sleep(200)
const install = Bun.spawnSync(${JSON.stringify(updateInstallCommand())}, { stdio: ['inherit', 'inherit', 'inherit'] })
if (install.exitCode !== 0) {
  console.error('picobu update failed: install exited with code ' + install.exitCode)
  process.exit(install.exitCode || 1)
}
const argv = sessionId ? ['picobu', '--session', sessionId] : ['picobu']
const child = Bun.spawn(argv, { cwd: cwd || process.cwd(), stdio: ['inherit', 'inherit', 'inherit'] })
process.exit(await child.exited)
`
}

export const spawnDetachedUpdate = (plan: UpdateLaunchPlan): void => {
  const helper = buildUpdateHelperScript(plan, process.pid)
  const child = Bun.spawn(['bun', '-e', helper], { stdio: ['inherit', 'inherit', 'inherit'], detached: true })
  child.unref()
}

export const runForegroundUpdate = async (plan: UpdateLaunchPlan): Promise<never> => {
  const install = Bun.spawnSync(updateInstallCommand(), { stdio: ['inherit', 'inherit', 'inherit'] })
  if (install.exitCode !== 0) {
    console.error(`picobu update failed: install exited with code ${install.exitCode}`)
    process.exit(install.exitCode || 1)
  }
  const argv = plan.sessionId ? ['picobu', '--session', plan.sessionId] : ['picobu']
  const child = Bun.spawn(argv, { cwd: plan.cwd ?? process.cwd(), stdio: ['inherit', 'inherit', 'inherit'] })
  process.exit(await child.exited)
}
