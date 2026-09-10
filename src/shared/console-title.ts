import { formatConsoleTitle } from '@shared/version.ts'

export const setConsoleTitle = (sessionTitle?: string): void => {
  const title = formatConsoleTitle(sessionTitle)
  process.title = title
  if (process.stdout?.isTTY) process.stdout.write(`\x1b]0;${title}\x07`)
}

export const resetConsoleTitle = (): void => {
  setConsoleTitle(undefined)
}
