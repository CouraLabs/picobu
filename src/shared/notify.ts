import { spawn } from "node:child_process";

const APP_NAME = "Picobu";

type NotifyStyle = {
  /** Render as an error (error icon on Windows, alert sound on macOS). */
  error?: boolean;
};

/** Fire the platform's desktop notification. Best-effort; never throws. */
function osNotify(title: string, message: string, style: NotifyStyle = {}): void {
  try {
    if (process.platform === "darwin") {
      const sound = style.error ? ` sound name "Basso"` : "";
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}${sound}`;
      spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "linux") {
      // Critical urgency for failures so they bypass do-not-disturb summaries.
      const args = style.error ? ["-u", "critical", title, message] : [title, message];
      spawn("notify-send", args, { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "win32") {
      // PowerShell NotifyIcon balloon needs a pumping message loop, so a timed
      // disposal is scheduled after the show to release the icon.
      const icon = style.error ? "Error" : "Info";
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        `$n = New-Object System.Windows.Forms.NotifyIcon`,
        `$n.Icon = [System.Drawing.SystemIcons]::Application`,
        `$n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::${icon}`,
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

/** Terminal BEL, shared by every notification flavor. */
function bell(): void {
  try {
    process.stdout.write("\x07");
  } catch {
    /* stdout may be detached; the desktop notification still fires */
  }
}

/** Cross-OS completion alert: terminal BEL plus an OS desktop notification. */
export function notifyCompletion(message = "Run complete"): void {
  bell();
  osNotify(APP_NAME, message);
}

/** Cross-OS failure alert: the error flavor (icon/urgency/sound vary by OS). */
export function notifyFailure(message: string): void {
  bell();
  osNotify(`${APP_NAME} — run failed`, message, { error: true });
}
