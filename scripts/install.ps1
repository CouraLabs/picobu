#
# picobu install script (Windows PowerShell)
#
# Usage:
#   powershell -c "irm https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.ps1|iex"
#
# Steps:
#   1. Validate git, install bun when missing
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
  Write-Log "bun not found — installing it now ..."
  irm https://bun.sh/install.ps1 | iex
  $BunDir = Join-Path $env:USERPROFILE ".bun\bin"
  if ((Test-Path $BunDir) -and -not (($env:Path -split ';') -contains $BunDir)) {
    $env:Path = "$BunDir;$env:Path"
  }
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Fail "Automatic bun install failed. Install it manually: powershell -c `"irm https://bun.sh/install.ps1|iex`", then re-run this script."
}

Write-Log "bun $((bun --version)) and git found."

# --- 2. Clone the repository --------------------------------------------------

if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }

Write-Log "Cloning $RepoUrl into $InstallDir ..."
git clone --depth 1 $RepoUrl $InstallDir

# --- 3. Build ------------------------------------------------------------------

Push-Location $InstallDir
try {
  Write-Log "Installing dependencies ..."
  try {
    bun install --os='*' --cpu='*'
  } catch {
    Write-Log "Full-platform install failed, retrying host-only install ..."
    bun install
  }

  $BunVersion = (bun --version).Trim()
  $BunParts = $BunVersion.Split('.')
  if ([int]$BunParts[0] -lt 1 -or ([int]$BunParts[0] -eq 1 -and [int]$BunParts[1] -lt 3)) {
    Write-Fail "bun >= 1.3.0 is required for OpenTUI standalone builds (found $BunVersion). Upgrade bun, then re-run this script."
  }

  $Target = 'bun-windows-x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    $Target = 'bun-windows-arm64'
  }
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Write-Log "Building standalone executable ($Target) ..."
  try {
    bun ./scripts/build-standalone.ts --target $Target --outfile $BinPath
  } catch {
    Write-Fail "Build failed. If the error names a darwin/linux native library, update bun, delete bun.lock, and re-run this script so all @opentui/core optionals install. $_"
  }
} finally {
  Pop-Location
}

# --- 4. Clean up -----------------------------------------------------------------

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
