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
if ($LASTEXITCODE -ne 0) {
  Write-Fail "git clone failed with exit code $LASTEXITCODE."
}

# --- 3. Build ------------------------------------------------------------------
#
# Native commands never throw on a non-zero exit in PowerShell, so every bun/git
# call is followed by a $LASTEXITCODE check. The build target (arch included) is
# resolved inside build-standalone.ts, so no PROCESSOR_ARCHITECTURE mapping is
# duplicated here. The wildcard install below is only a fallback for builds that
# miss native optionals.

Push-Location $InstallDir
try {
  Write-Log "Installing dependencies ..."
  bun install
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "bun install failed with exit code $LASTEXITCODE."
  }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Write-Log "Building standalone executable ..."
  bun ./scripts/build-standalone.ts --outfile $BinPath
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Build failed - retrying with a full-platform install of native optionals ..."
    bun install --os='*' --cpu='*'
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "bun install --os='*' --cpu='*' failed with exit code $LASTEXITCODE."
    }
    bun ./scripts/build-standalone.ts --outfile $BinPath
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Build failed. If the error names a missing native library, update bun, delete bun.lock, and re-run this script so all @opentui/core optionals install. (exit code $LASTEXITCODE)"
    }
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
