#!/usr/bin/env bash
# picobu uninstaller: deletes ~/.picobu entirely (binary, source clone,
# sessions, settings, OAuth credentials) and removes the PATH entry added by
# scripts/install.sh.
set -euo pipefail

PICOBU_HOME="$HOME/.picobu"

if [ -d "$PICOBU_HOME" ]; then
  echo "==> deleting $PICOBU_HOME"
  echo "    (binary, source clone, sessions, options.json, auth.json, WhatsApp auth)"
  rm -rf "$PICOBU_HOME"
else
  echo "==> $PICOBU_HOME not found; nothing to delete"
fi

# Remove the PATH lines install.sh appended to shell rc files (exact match
# only; never touches user lines that merely mention .picobu).
remove_from_rc() {
  local rc="$1" line="$2"
  [ -f "$rc" ] || return 0
  local tmp
  tmp="$(mktemp)"
  grep -vF "$line" "$rc" >"$tmp" || true
  if ! cmp -s "$rc" "$tmp"; then
    cat "$tmp" >"$rc"
    echo "==> removed picobu PATH entry from $rc"
  fi
  rm -f "$tmp"
}

PICOBU_PATH_LINE='export PATH="$HOME/.picobu/bin:$PATH"'
remove_from_rc "$HOME/.zshrc" "$PICOBU_PATH_LINE"
remove_from_rc "$HOME/.bash_profile" "$PICOBU_PATH_LINE"
remove_from_rc "$HOME/.bashrc" "$PICOBU_PATH_LINE"
remove_from_rc "$HOME/.config/fish/config.fish" 'fish_add_path "$HOME/.picobu/bin"'

echo "==> picobu uninstalled; open a new shell so PATH changes take effect"
