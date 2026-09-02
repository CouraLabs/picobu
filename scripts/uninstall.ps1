#
# picobu uninstall script (Windows PowerShell)
#
# Usage:
#   powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/uninstall.ps1|iex"
#
# Removes everything under ~\.picobu, including the executable, saved
# sessions, credentials and settings, and strips ~\.picobu\bin from
# the user PATH.
#

$ErrorActionPreference = "Stop"

$PicobuHome = Join-Path $env:USERPROFILE ".picobu"
$BinDir     = Join-Path $PicobuHome "bin"

function Write-Log  { Write-Host "[picobu] $args" -ForegroundColor Magenta }
function Write-Fail { Write-Host "[picobu] $args" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $PicobuHome)) {
  Write-Log "picobu is not installed ($PicobuHome not found). Nothing to do."
  exit 0
}

Write-Log "This will permanently delete $PicobuHome, including:"
Write-Log "  - the picobu executable"
Write-Log "  - saved sessions, settings and OAuth credentials"
$answer = Read-Host "Continue? [y/N]"
if ($answer -notmatch '^[yY]') {
  Write-Log "Aborted."
  exit 0
}

# --- Remove the user PATH entry ------------------------------------------------

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath) {
  $Entries = $UserPath -split ';' | Where-Object { $_ -and ($_ -ne $BinDir) }
  $Updated = $Entries -join ';'
  if ($Updated -ne $UserPath) {
    [Environment]::SetEnvironmentVariable("Path", $Updated, "User")
    Write-Log "Removed $BinDir from the user PATH"
  }
}

# --- Delete everything ------------------------------------------------------------

Remove-Item -Recurse -Force $PicobuHome
Write-Log "Removed $PicobuHome"
Write-Log "picobu uninstalled. Restart your terminal to refresh your PATH."
