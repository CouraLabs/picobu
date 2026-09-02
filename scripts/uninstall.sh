#!/usr/bin/env bash
#
# picobu uninstall script (Linux / macOS)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CouraLabs/picobu/main/scripts/uninstall.sh | bash -s -- [-y]
#
# Removes everything under ~/.picobu, including the executable, saved
# sessions, credentials and settings, and strips ~/.picobu/bin from
# the shell profile PATH.
#
set -euo pipefail

PICOBU_HOME="$HOME/.picobu"
BIN_DIR="$PICOBU_HOME/bin"
ASSUME_YES=false

log()  { printf '\033[1;35m[picobu]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[picobu]\033[0m %s\n' "$1" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=true ;;
    *) fail "Unknown option: $arg" ;;
  esac
done

if [ ! -d "$PICOBU_HOME" ]; then
  log "picobu is not installed ($PICOBU_HOME not found). Nothing to do."
  exit 0
fi

if [ "$ASSUME_YES" != true ]; then
  log "This will permanently delete $PICOBU_HOME, including:"
  log "  - the picobu executable"
  log "  - saved sessions, settings and OAuth credentials"
  if [ -t 0 ]; then
    read -r -p "Continue? [y/N] " answer
    case "$answer" in
      y|Y|yes|YES) ;;
      *) log "Aborted."; exit 0 ;;
    esac
  else
    fail "Refusing to delete $PICOBU_HOME without confirmation. Re-run with -y to force."
  fi
fi

# --- Remove PATH entries from shell profiles --------------------------------

strip_profile() {
  local profile="$1"
  [ -f "$profile" ] || return 0
  sed -i.bak '/# picobu/d; /\.picobu\/bin/d' "$profile" && rm -f "$profile.bak"
}

case "${SHELL:-}" in
  */zsh)  strip_profile "$HOME/.zshrc" ;;
  */bash) if [ "$(uname)" = "Darwin" ]; then strip_profile "$HOME/.bash_profile"; else strip_profile "$HOME/.bashrc"; fi ;;
  *)      strip_profile "$HOME/.profile" ;;
esac

# --- Delete everything ------------------------------------------------------

rm -rf "$PICOBU_HOME"
log "Removed $PICOBU_HOME"
log "picobu uninstalled. Restart your terminal to refresh your PATH."
