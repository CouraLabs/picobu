import { formatConsoleTitle } from '@shared/version.ts'

export const setConsoleTitle = (appName: string, sessionId?: string, sessionTitle?: string): void => {
  const title = formatConsoleTitle(appName, sessionId, sessionTitle)
  process.title = title
  if (process.stdout?.isTTY) process.stdout.write(`\x1b]0;${title}\x07`)
}

export const resetConsoleTitle = (appName: string): void => {
  setConsoleTitle(appName)
}
