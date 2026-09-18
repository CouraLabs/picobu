# picobu uninstaller for Windows: removes the global @couralabs/picobu npm
# package, deletes $env:USERPROFILE\.picobu entirely (sessions, settings,
# OAuth credentials), and strips the legacy picobu bin user-PATH entry.
$ErrorActionPreference = 'Stop'

$PackageName = '@couralabs/picobu'
$PicobuHome = Join-Path $env:USERPROFILE '.picobu'
$BinDir = Join-Path $PicobuHome 'bin'

if (Get-Command bun -ErrorAction SilentlyContinue) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    bun remove -g $PackageName 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "==> removed the global $PackageName package"
    } else {
      Write-Host "==> note: bun remove -g $PackageName failed (was picobu installed via bun?)"
    }
  } finally {
    $ErrorActionPreference = $eap
  }
} else {
  Write-Host '==> note: bun not found; skipping global package removal'
}

if (Test-Path $PicobuHome) {
  Write-Host "==> deleting $PicobuHome"
  Write-Host '    (sessions, options.json, auth.json, WhatsApp auth)'
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
$chromeCache = if ($env:PUPPETEER_CACHE_DIR) { $env:PUPPETEER_CACHE_DIR } else { Join-Path $env:USERPROFILE '.cache\puppeteer' }
Write-Host "==> note: the puppeteer Chrome cache in $chromeCache is shared with other tools and was left in place"
