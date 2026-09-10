import { spawn } from 'node:child_process'

const APP_NAME = 'Picobu'

type NotifyStyle = {
  error?: boolean
}

function osNotify(title: string, message: string, style: NotifyStyle = {}): void {
  try {
    if (process.platform === 'darwin') {
      const sound = style.error ? ` sound name "Basso"` : ''
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}${sound}`
      const child = spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true })
      child.on('error', () => {})
      child.unref()
    } else if (process.platform === 'linux') {
      const args = style.error ? ['-u', 'critical', title, message] : [title, message]
      const child = spawn('notify-send', args, { stdio: 'ignore', detached: true })
      child.on('error', () => {})
      child.unref()
    } else if (process.platform === 'win32') {
      const icon = style.error ? 'Error' : 'Info'
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        `$n = New-Object System.Windows.Forms.NotifyIcon`,
        `$n.Icon = [System.Drawing.SystemIcons]::Application`,
        `$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::${icon}`,
        `$n.BalloonTipTitle = ${JSON.stringify(title)}`,
        `$n.BalloonTipText = ${JSON.stringify(message)}`,
        `$n.Visible = $true`,
        `$n.ShowBalloonTip(0)`,
        'Start-Sleep -Milliseconds 6000',
        '$n.Dispose()',
      ].join('; ')
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: 'ignore',
        detached: true,
      })
      child.on('error', () => {})
      child.unref()
    }
  } catch {}
}

function bell(): void {
  try {
    process.stdout.write('\x07')
  } catch {}
}

export function notifyCompletion(message = 'Run complete'): void {
  bell()
  osNotify(APP_NAME, message)
}

export function notifyFailure(message: string): void {
  bell()
  osNotify(`${APP_NAME} — run failed`, message, { error: true })
}

export function notifyStale(message = 'The session is stale'): void {
  bell()
  osNotify(APP_NAME, message)
}

export function notifyBlocking(message: string): void {
  bell()
  osNotify(APP_NAME, message)
}
