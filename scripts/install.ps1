# picobu installer for Windows: clones the repo, installs deps, and compiles a
# standalone binary to $env:USERPROFILE\.picobu\bin\picobu.exe.
$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/CouraLabs/picobu.git'
$PicobuHome = Join-Path $env:USERPROFILE '.picobu'
$SourceDir = Join-Path $PicobuHome 'source'
$CloneDir = Join-Path $SourceDir 'picobu'
$BinDir = Join-Path $PicobuHome 'bin'
$BinPath = Join-Path $BinDir 'picobu.exe'

function Log { param([string]$Message) Write-Host "==> $Message" }
function Fail { param([string]$Message) Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail @"
git is required. Install it with one of:
  winget install --id Git.Git        (Windows)
  brew install git                   (macOS)
  sudo apt-get install git           (Debian/Ubuntu)
"@
}

function Ensure-Bun {
  if (Get-Command bun -ErrorAction SilentlyContinue) { return }
  $bunLocal = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  if (Test-Path $bunLocal) {
    $env:Path = "$(Split-Path $bunLocal -Parent);$env:Path"
    return
  }
  Log 'bun not found; installing via https://bun.sh'
  irm https://bun.sh/install.ps1 | iex
  if (Test-Path $bunLocal) {
    $env:Path = "$(Split-Path $bunLocal -Parent);$env:Path"
  }
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Fail 'bun installation did not produce a bun on PATH; install manually from https://bun.sh'
  }
}

Ensure-Bun

Log "creating $PicobuHome"
New-Item -ItemType Directory -Force -Path $SourceDir, $BinDir | Out-Null

if (Test-Path $CloneDir) {
  Log "removing existing clone at $CloneDir"
  Remove-Item -Recurse -Force $CloneDir
}

Log "cloning $RepoUrl into $CloneDir"
git clone --depth 1 $RepoUrl $CloneDir
if ($LASTEXITCODE -ne 0) { Fail "git clone failed with exit code $LASTEXITCODE" }
Push-Location $CloneDir
try {
  Log 'installing dependencies'
  bun install --os="*" --cpu="*" --no-cache --no-save --trust
  if ($LASTEXITCODE -ne 0) { Fail "bun install failed with exit code $LASTEXITCODE" }

  Log "compiling binary to $BinPath"
  bun build --compile src/cli.ts --outfile $BinPath
  if ($LASTEXITCODE -ne 0) { Fail "bun build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

if (-not (Test-Path $BinPath)) {
  Fail "compile did not produce $BinPath"
}

$binEntry = $BinDir
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -and $userPath.Split(';') -contains $binEntry) {
  Log 'user PATH already contains picobu bin; leaving it unchanged'
} else {
  $nextPath = if ($userPath) { "$binEntry;$userPath" } else { $binEntry }
  [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')
  Log 'prepended picobu bin to the user PATH'
}
if (-not ($env:Path.Split(';') -contains $binEntry)) {
  $env:Path = "$binEntry;$env:Path"
}

Write-Host ''
Log "picobu installed: $BinPath"
Log 'open a new terminal so the updated PATH takes effect, then run: picobu'
Log 'rerun this installer anytime to update picobu (fresh re-clone + recompile)'
