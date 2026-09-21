# picobu installer for Windows: installs Bun when missing, then installs the
# published @couralabs/picobu npm package globally via `bun add -g`.
$ErrorActionPreference = 'Stop'

$PackageName = '@couralabs/picobu'
# stamped by scripts/publish.ts — do not edit by hand
$PicobuVersionDefault = '1.30.5'
$PuppeteerVersionDefault = '25.10.0'
$PicobuVersion = if ($env:PICOBU_VERSION) { $env:PICOBU_VERSION } else { $PicobuVersionDefault }
$PicobuHome = Join-Path $env:USERPROFILE '.picobu'
$LegacyBin = Join-Path $PicobuHome 'bin\picobu.exe'
$LegacyBinDir = Join-Path $PicobuHome 'bin'
$BunBin = Join-Path $env:USERPROFILE '.bun\bin'
$PuppeteerCache = if ($env:PUPPETEER_CACHE_DIR) { $env:PUPPETEER_CACHE_DIR } else { Join-Path $env:USERPROFILE '.cache\puppeteer' }

$UseColor = -not [Console]::IsOutputRedirected -and -not $env:NO_COLOR
function Dim($Message) {
  if ($UseColor) { Write-Host "  $Message" -ForegroundColor DarkGray } else { Write-Host "  $Message" }
}
function Run($Message) {
  if ($UseColor) { Write-Host "  · $Message" -ForegroundColor DarkGray } else { Write-Host "  · $Message" }
}
function Ok($Message) {
  if ($UseColor) { Write-Host "  ✓ $Message" -ForegroundColor Green } else { Write-Host "  ✓ $Message" }
}
function Fail($Message) {
  if ($UseColor) { Write-Host "error: $Message" -ForegroundColor Red } else { Write-Host "error: $Message" }
  exit 1
}

function Ensure-Bun {
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    Run "Bun $(bun --version)"
    return
  }
  $bunLocal = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  if (Test-Path $bunLocal) {
    $env:Path = "$(Split-Path $bunLocal -Parent);$env:Path"
    Run "Bun $(bun --version)"
    return
  }
  Run 'Installing Bun via https://bun.sh'
  irm https://bun.sh/install.ps1 | iex
  if (Test-Path $bunLocal) {
    $env:Path = "$(Split-Path $bunLocal -Parent);$env:Path"
  }
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Fail 'bun installation did not produce a bun on PATH; install manually from https://bun.sh'
  }
  Run "Bun $(bun --version)"
}

Write-Host ''
Run "Installing picobu → global bun package $PackageName@$PicobuVersion"
Write-Host ''

Ensure-Bun

if (Test-Path $LegacyBin) {
  Remove-Item -Force $LegacyBin
  Ok 'removed legacy compiled binary'
}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and ($userPath.Split(';') | Where-Object { $_ -eq $LegacyBinDir })) {
  $nextPath = ($userPath.Split(';') | Where-Object { $_ -ne $LegacyBinDir }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')
  Ok 'removed legacy picobu bin from the user PATH'
}

Run "Installing $PackageName@$PicobuVersion"
$installOut = bun add -g "$PackageName@$PicobuVersion" --trust 2>&1
if ($LASTEXITCODE -ne 0) {
  $installOut | ForEach-Object { Dim "| $_" }
  Fail "bun add -g failed with exit code $LASTEXITCODE"
}
Ok 'Package installed'

if (-not (Get-Command picobu -ErrorAction SilentlyContinue)) {
  $shim = @('picobu.exe', 'picobu.cmd', 'picobu.ps1') | Where-Object { Test-Path (Join-Path $BunBin $_) } | Select-Object -First 1
  if ($shim) {
    $env:Path = "$BunBin;$env:Path"
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not ($userPath -and ($userPath.Split(';') | Where-Object { $_ -eq $BunBin }))) {
      [Environment]::SetEnvironmentVariable('Path', "$BunBin;$userPath", 'User')
    }
  }
}
$cli = Get-Command picobu -ErrorAction SilentlyContinue
if (-not $cli) {
  Fail "picobu was installed but is not on PATH. Add it with:`n  `$env:Path = `"$BunBin;`$env:Path`""
}
$cliPath = $cli.Source

Run 'Smoke test (--version)'
$smokeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("picobu-smoke-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
Push-Location $smokeDir
try {
  # Native stderr under Windows PowerShell 5.1 becomes a terminating error
  # with EAP=Stop, so keep EAP relaxed for the native call below and fail on
  # the exit code only.
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $cliPath --version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "smoke test failed: picobu --version did not run cleanly" }
    $script:PicobuVersion = (& $cliPath --version 2>&1 | Select-Object -First 1)
  } finally {
    $ErrorActionPreference = $eap
  }
} finally {
  Pop-Location
  Remove-Item -Recurse -Force $smokeDir -ErrorAction SilentlyContinue
}
Ok "picobu $PicobuVersion installed"

# PATH wiring for buns not installed via bun.sh (winget, npm): their users have
# no .bun\bin entry, but `bun add -g` always shims into $BunBin.
$userPathCheck = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPathCheck -and ($userPathCheck.Split(';') | Where-Object { $_ -eq $BunBin })) -and (Test-Path (Join-Path $BunBin 'bun.exe'))) {
  [Environment]::SetEnvironmentVariable('Path', "$BunBin;$userPathCheck", 'User')
  Ok 'PATH updated (user PATH now contains the bun bin dir)'
}

if (-not (Test-Path $PuppeteerCache) -or -not (Get-ChildItem $PuppeteerCache -Force -ErrorAction SilentlyContinue)) {
  Run 'Provisioning Chrome for the web tool'
  $chromeOut = bunx "puppeteer@$PuppeteerVersionDefault" browsers install chrome 2>&1
  if ($LASTEXITCODE -ne 0) {
    $chromeOut | ForEach-Object { Dim "| $_" }
    Fail 'chrome provisioning failed (puppeteer browsers install chrome)'
  }
  Ok 'Chrome provisioned'
}

$logo = @(
  '┌╦═══╦┐┌═╤╦╤═┐┌╦═══╦┐┌╦═══╦┐┌╦══╦┐ ┌╦   ╦┐'
  '│╠═══╩┘  │║│  │║     │║   ║││╠══╩╗┐│║   ║│'
  '└╩     └═╧╩╧═┘└╩═══╩┘└╩═══╩┘└╩═══╩┘└╩═══╩┘'
)
Write-Host ''
foreach ($line in $logo) { Dim $line }
Write-Host ''
Write-Host "  picobu $PicobuVersion installed"
Write-Host ''
Write-Host '  cd <project>'
Write-Host '  picobu'
Write-Host ''
Dim 'open a new terminal if picobu is not found'
Dim "update with: bun update -g $PackageName"
Dim "or rerun this installer (pins $PicobuVersion; `$env:PICOBU_VERSION='latest' tracks the newest release)"
Dim 'uninstall: irm https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/uninstall.ps1|iex'
Write-Host ''
