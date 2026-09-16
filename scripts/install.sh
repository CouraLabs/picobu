#!/usr/bin/env bash
#
# picobu install script (Linux / macOS)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/refs/heads/master/scripts/install.sh | bash
#
# Steps:
#   1. Validate git, install bun when missing
#   2. Clone the repo into ~/.picobu/install
#   3. Build a standalone executable with bun
#   4. Move the executable to ~/.picobu/bin
#   5. Remove ~/.picobu/install
#   6. Add ~/.picobu/bin to the user PATH
#
set -euo pipefail

REPO_URL="https://github.com/CouraLabs/picobu.git"
PICOBU_HOME="$HOME/.picobu"
INSTALL_DIR="$PICOBU_HOME/install"
BIN_DIR="$PICOBU_HOME/bin"
BIN_PATH="$BIN_DIR/picobu"

log()  { printf '\033[1;35m[picobu]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[picobu]\033[0m %s\n' "$1" >&2; exit 1; }

# --- 1. Validate prerequisites -------------------------------------------

command -v git >/dev/null 2>&1 || fail "git is required but not installed. Install it first: https://git-scm.com"

if ! command -v bun >/dev/null 2>&1; then
  log "bun not found — installing it now ..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || fail "Automatic bun install failed. Install it manually (curl -fsSL https://bun.sh/install | bash), then re-run this script."

log "bun $(bun --version) and git found."

# --- 2. Clone the repository ---------------------------------------------

rm -rf "$INSTALL_DIR"
log "Cloning $REPO_URL into $INSTALL_DIR ..."
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"

# --- 3. Build -------------------------------------------------------------

cd "$INSTALL_DIR"
log "Installing dependencies ..."
if ! bun install; then
  fail "bun install failed."
fi

# The build target (including the host libc on linux) is resolved inside
# build-standalone.ts, so no uname mapping is duplicated here. The wildcard
# install below is only a fallback for builds that miss native optionals.
mkdir -p "$BIN_DIR"
if ! bun ./scripts/build-standalone.ts --outfile "$BIN_DIR/picobu"; then
  log "Build failed - retrying with a full-platform install of native optionals ..."
  if ! bun install --os='*' --cpu='*'; then
    fail "Full-platform install failed."
  fi
  if ! bun ./scripts/build-standalone.ts --outfile "$BIN_DIR/picobu"; then
    fail "Build failed. If the error names a missing native library, update bun, delete bun.lock, and re-run this script so all @opentui/core optionals install."
  fi
fi

# --- 4. Clean up ----------------------------------------------------------

cd "$HOME"
rm -rf "$INSTALL_DIR"
log "Removed $INSTALL_DIR"

# --- 5. PATH setup ---------------------------------------------------------

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) export PATH="$BIN_DIR:$PATH" ;;
esac

add_to_profile() {
  local profile="$1"
  [ -f "$profile" ] || touch "$profile"
  if ! grep -q 'picobu/bin' "$profile"; then
    printf '\n# picobu\nexport PATH="$HOME/.picobu/bin:$PATH"\n' >> "$profile"
    log "Added $BIN_DIR to $profile"
  fi
}

add_to_fish() {
  local config="$HOME/.config/fish/config.fish"
  mkdir -p "$(dirname "$config")"
  [ -f "$config" ] || touch "$config"
  if ! grep -q 'picobu/bin' "$config"; then
    printf '\n# picobu\nset -gx PATH "$HOME/.picobu/bin" $PATH\n' >> "$config"
    log "Added $BIN_DIR to $config"
  fi
}

case "${SHELL:-}" in
  */zsh)  add_to_profile "$HOME/.zshrc" ;;
  */bash) if [ "$(uname)" = "Darwin" ]; then add_to_profile "$HOME/.bash_profile"; else add_to_profile "$HOME/.bashrc"; fi ;;
  */fish) add_to_fish ;;
  *)      add_to_profile "$HOME/.profile" ;;
esac

# --- Done ------------------------------------------------------------------

log "picobu installed successfully at $BIN_PATH"
log "Run 'source ~/.zshrc' (or restart your terminal), then run: picobu"
