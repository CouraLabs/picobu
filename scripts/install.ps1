#
# picobu install script (Windows PowerShell)
#
# Usage:
#   powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/install.ps1|iex"
#
# Steps:
#   1. Validate that bun and git are available
#   2. Clone the repo into ~\.picobu\install
#   3. Build a standalone executable with bun
#   4. Move the executable to ~\.picobu\bin
#   5. Remove ~\.picobu\install
#   6. Add ~\.picobu\bin to the user PATH
#

$ErrorActionPreference = "Stop"

$RepoUrl    = "https://github.com/CouraLabs/picobu.git"
$PicobuHome = Join-Path $env:USERPROFILE ".picobu"
$InstallDir = Join-Path $PicobuHome "install"
$BinDir     = Join-Path $PicobuHome "bin"
$BinPath    = Join-Path $BinDir "picobu.exe"

function Write-Log  { Write-Host "[picobu] $args" -ForegroundColor Magenta }
function Write-Fail { Write-Host "[picobu] $args" -ForegroundColor Red; exit 1 }

# --- 1. Validate prerequisites ----------------------------------------------

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Fail "git is required but not installed. Install it first: https://git-scm.com"
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Fail "bun is required but not installed. Install it first: powershell -c `"irm bun.sh/install.ps1|iex`""
}

Write-Log "bun $((bun --version)) and git found."

# --- 2. Clone the repository --------------------------------------------------

if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }

Write-Log "Cloning $RepoUrl into $InstallDir ..."
git clone --depth 1 $RepoUrl $InstallDir

# --- 3. Build ------------------------------------------------------------------

Set-Location $InstallDir
Write-Log "Installing dependencies ..."
bun install

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Write-Log "Building standalone executable ..."
bun build --compile src/cli.ts --outfile $BinPath

# --- 4. Clean up -----------------------------------------------------------------

Set-Location $env:USERPROFILE
Remove-Item -Recurse -Force $InstallDir
Write-Log "Removed $InstallDir"

# --- 5. PATH setup -----------------------------------------------------------------

if (-not (($env:Path -split ';') -contains $BinDir)) {
  $env:Path = "$BinDir;$env:Path"
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($UserPath -split ';') -contains $BinDir)) {
  [Environment]::SetEnvironmentVariable("Path", "$BinDir;$UserPath", "User")
  Write-Log "Added $BinDir to the user PATH"
}

# --- Done ---------------------------------------------------------------------------

Write-Log "picobu installed successfully at $BinPath"
Write-Log "Restart your terminal, then run: picobu"
