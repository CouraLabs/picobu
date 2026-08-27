import { spawn } from "node:child_process";

const APP_NAME = "PICOBU";

/** Fire the platform's desktop notification. Best-effort; never throws. */
function osNotify(title: string, message: string): void {
  try {
    if (process.platform === "darwin") {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
      spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "linux") {
      spawn("notify-send", [title, message], { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "win32") {
      // PowerShell NotifyIcon balloon needs a pumping message loop, so a timed
      // disposal is scheduled after the show to release the icon.
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        `$n = New-Object System.Windows.Forms.NotifyIcon`,
        `$n.Icon = [System.Drawing.SystemIcons]::Application`,
        `$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info`,
        `$n.BalloonTipTitle = ${JSON.stringify(title)}`,
        `$n.BalloonTipText = ${JSON.stringify(message)}`,
        `$n.Visible = $true`,
        `$n.ShowBalloonTip(0)`,
        "Start-Sleep -Milliseconds 6000",
        "$n.Dispose()",
      ].join("; ");
      spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
        stdio: "ignore",
        detached: true,
      }).unref();
    }
  } catch {
    /* notifier missing or unavailable -> drop silently; terminal bell still fires */
  }
}

/** Cross-OS completion alert: terminal BEL plus an OS desktop notification. */
export function notifyCompletion(message = "Run complete"): void {
  try {
    process.stdout.write("\x07");
  } catch {
    /* stdout may be detached; the desktop notification still fires */
  }
  osNotify(APP_NAME, message);
}