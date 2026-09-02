#!/usr/bin/env bash
#
# picobu install script (Linux / macOS)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/install.sh | bash
#
# Steps:
#   1. Validate that bun and git are available
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
command -v bun >/dev/null 2>&1 || fail "bun is required but not installed. Install it first: curl -fsSL https://bun.sh/install | bash"

log "bun $(bun --version) and git found."

# --- 2. Clone the repository ---------------------------------------------

rm -rf "$INSTALL_DIR"
log "Cloning $REPO_URL into $INSTALL_DIR ..."
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"

# --- 3. Build -------------------------------------------------------------

cd "$INSTALL_DIR"
log "Installing dependencies ..."
bun install

mkdir -p "$BIN_DIR"
log "Building standalone executable ..."
bun build --compile src/cli.ts --outfile "$BIN_DIR/picobu"

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

case "${SHELL:-}" in
  */zsh)  add_to_profile "$HOME/.zshrc" ;;
  */bash) if [ "$(uname)" = "Darwin" ]; then add_to_profile "$HOME/.bash_profile"; else add_to_profile "$HOME/.bashrc"; fi ;;
  *)      add_to_profile "$HOME/.profile" ;;
esac

# --- Done ------------------------------------------------------------------

log "picobu installed successfully at $BIN_PATH"
log "Run 'source ~/.zshrc' (or restart your terminal), then run: picobu"
