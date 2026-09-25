export interface ShellSpec {
  cmd: Array<string>
}

export function shellSpec(shellLabel: string): ShellSpec {
  const [platform, shell] = shellLabel.split(':')
  if (platform === 'Windows') {
    switch (shell) {
      case 'PowerShell':
        return { cmd: ['powershell', '-Command'] }
      case 'Bash':
        return { cmd: ['bash', '-c'] }
      case 'cmd.exe':
        return { cmd: ['cmd', '/c'] }
    }
  } else {
    switch (shell) {
      case 'Zsh':
        return { cmd: ['zsh', '-c'] }
      case 'Bash':
        return { cmd: ['bash', '-c'] }
      case 'Fish':
        return { cmd: ['fish', '-c'] }
      case 'Sh':
        return { cmd: ['sh', '-c'] }
    }
  }
  return { cmd: [Bun.env.SHELL || '/bin/sh', '-c'] }
}

export const killProcessTree = (proc: Bun.Subprocess): void => {
  try {
    if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid, 'SIGKILL')
    else proc.kill(9)
  } catch {}
}
