export const detectShell = (): string => {
  const platform = process.platform;

  if (platform === 'win32') {
    if (Bun.env.ORIGINAL_PATH?.includes('Git')) {
      return 'Windows:Bash';
    }
    if (Bun.env.PSModulePath) {
      return 'Windows:PowerShell';
    }
    return 'Windows:cmd.exe';
  }

  const shellPath = Bun.env.SHELL || '';
  if (shellPath.includes('zsh')) return 'Unix:Zsh';
  if (shellPath.includes('bash')) return 'Unix:Bash';
  if (shellPath.includes('fish')) return 'Unix:Fish';
  if (shellPath.includes('sh')) return 'Unix:Sh';

  try {
    const proc = Bun.spawnSync({
      cmd: ["ps", "-p", String(process.ppid), "-o", "comm="],
    });
    const parentProcessName = proc.stdout.toString().trim();
    return parentProcessName || 'POSIX';
  } catch {
    return 'POSIX';
  }
}
