# picobu installer for Windows: clones the repo, installs deps, and compiles a
# standalone binary to $env:USERPROFILE\.picobu\bin\picobu.exe.
$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/CouraLabs/picobu.git'
$PicobuHome = Join-Path $env:USERPROFILE '.picobu'
$SourceDir = Join-Path $PicobuHome 'source'
$CloneDir = Join-Path $SourceDir 'picobu'
$BinDir = Join-Path $PicobuHome 'bin'
$BinPath = Join-Path $BinDir 'picobu.exe'

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

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail @"
git is required. Install it with one of:
  winget install --id Git.Git        (Windows)
  brew install git                   (macOS)
  sudo apt-get install git           (Debian/Ubuntu)
"@
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
Dim "Installing picobu → $BinPath"
Write-Host ''

Ensure-Bun

Run "Preparing $PicobuHome"
New-Item -ItemType Directory -Force -Path $SourceDir, $BinDir | Out-Null

if (Test-Path $CloneDir) {
  Run 'Removing previous clone'
  Remove-Item -Recurse -Force $CloneDir
}

Run "Cloning $RepoUrl"
git clone -q --depth 1 $RepoUrl $CloneDir
if ($LASTEXITCODE -ne 0) { Fail "git clone failed with exit code $LASTEXITCODE" }

Push-Location $CloneDir
try {
  $PicobuVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version

  Run 'Installing dependencies'
  $installOut = bun install --os="*" --cpu="*" --no-cache --no-save --trust 2>&1
  if ($LASTEXITCODE -ne 0) {
    $installOut | ForEach-Object { Dim "| $_" }
    Fail "bun install failed with exit code $LASTEXITCODE"
  }
  $pkgCount = ($installOut | Select-String -Pattern '(\d+) packages installed').Matches.Groups[1].Value
  if ($pkgCount) { Ok "Dependencies installed ($pkgCount packages)" } else { Ok 'Dependencies installed' }

  Run 'Compiling binary'
  $buildOut = bun scripts/build.ts --out-dir $BinDir --quiet 2>&1
  if ($LASTEXITCODE -ne 0) {
    $buildOut | ForEach-Object { Dim "| $_" }
    Fail "compile failed with exit code $LASTEXITCODE"
  }
  if (-not (Test-Path $BinPath)) { Fail "compile did not produce $BinPath" }
  $sizeMb = '{0:N1} MB' -f ((Get-Item $BinPath).Length / 1MB)
  Ok "Binary compiled ($BinPath, $sizeMb)"

  Run 'Smoke test (--version)'
  $smokeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("picobu-smoke-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
  Push-Location $smokeDir
  try {
    # Native stderr under Windows PowerShell 5.1 becomes a terminating error
    # with EAP=Stop, so relax it for this call and fail on the exit code only.
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $BinPath --version 2>&1 | Out-Null
    } finally {
      $ErrorActionPreference = $eap
    }
    if ($LASTEXITCODE -ne 0) { Fail "smoke test failed: $BinPath --version did not run cleanly" }
  } finally {
    Pop-Location
    Remove-Item -Recurse -Force $smokeDir -ErrorAction SilentlyContinue
  }
  Ok "picobu $(& $BinPath --version) runs cleanly"
} finally {
  Pop-Location
}

$binEntry = $BinDir
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and $userPath.Split(';') -contains $binEntry) {
  Ok 'PATH already configured (user PATH contains picobu bin)'
} else {
  $nextPath = if ($userPath) { "$binEntry;$userPath" } else { $binEntry }
  [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')
  Ok 'PATH updated (user PATH)'
}
if (-not ($env:Path.Split(';') -contains $binEntry)) {
  $env:Path = "$binEntry;$env:Path"
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
Dim 'open a new terminal so the updated PATH takes effect'
Dim 'rerun this installer to update picobu (fresh re-clone + recompile)'
Write-Host ''
