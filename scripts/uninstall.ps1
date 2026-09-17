# picobu uninstaller for Windows: deletes $env:USERPROFILE\.picobu entirely
# (binary, source clone, sessions, settings, OAuth credentials) and removes the
# PATH entry added by scripts/install.ps1.
$ErrorActionPreference = 'Stop'

$PicobuHome = Join-Path $env:USERPROFILE '.picobu'
$BinDir = Join-Path $PicobuHome 'bin'

if (Test-Path $PicobuHome) {
  Write-Host "==> deleting $PicobuHome"
  Write-Host '    (binary, source clone, sessions, options.json, auth.json, WhatsApp auth)'
  Remove-Item -Recurse -Force $PicobuHome
} else {
  Write-Host "==> $PicobuHome not found; nothing to delete"
}

$binEntry = $BinDir
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and ($userPath.Split(';') | Where-Object { $_ -eq $binEntry })) {
  $nextPath = ($userPath.Split(';') | Where-Object { $_ -ne $binEntry }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')
  Write-Host '==> removed picobu bin from the user PATH'
}

Write-Host '==> picobu uninstalled; open a new terminal so PATH changes take effect'
